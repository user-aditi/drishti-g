import { Router } from 'express'
import { Channel, Prisma, RequestStatus } from '@prisma/client'
import { z } from 'zod'
import { referenceDate } from '../config/systemClock.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireAgent } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { runFiledHooks } from '../services/requestHooks.js'
import { nextSrNumber, routeRequest } from '../services/routing.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { publicRequest } from '../utils/serialize.js'
import { invalidateBoards, warmBoards } from './boards.js'

export const requestsRouter: Router = Router()

const REQUEST_INCLUDE = {
  type: { include: { agency: true } },
  descriptor: true,
  agency: true,
  orgUnit: true,
} as const

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

const fileSchema = z.object({
  typeId: z.number().int().positive(),
  descriptorId: z.number().int().positive().nullable().optional(),
  orgUnitId: z.number().int().positive().nullable().optional(),
  address: z.string().max(256).optional(),
  zip: z.string().max(16).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  channel: z.nativeEnum(Channel).optional(),
})

/**
 * File a request.
 *
 * Unauthenticated on purpose. NYC 311 takes reports from anyone — most of them
 * arrive by telephone from someone with no account at all — and a replica that
 * demanded a login before accepting a pothole report would not be a replica. A
 * signed-in citizen is attributed; everyone else files anonymously.
 */
requestsRouter.post(
  '/',
  validate(fileSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof fileSchema>

    // Filed *now*, unlike an imported row, whose timestamp is New York's.
    const filedAt = new Date()

    if (body.descriptorId != null) {
      const descriptor = await prisma.requestDescriptor.findUnique({
        where: { id: body.descriptorId },
        select: { requestTypeId: true },
      })
      if (!descriptor) throw badRequest('That descriptor does not exist')
      if (descriptor.requestTypeId !== body.typeId) {
        throw badRequest('That descriptor does not belong to the chosen request type')
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const routed = await routeRequest(tx, body.typeId, filedAt)
      const srNumber = await nextSrNumber(tx, filedAt)

      const request = await tx.serviceRequest.create({
        data: {
          srNumber,
          citizenId: req.user?.id ?? null,
          typeId: body.typeId,
          descriptorId: body.descriptorId ?? null,
          agencyId: routed.agencyId,
          orgUnitId: body.orgUnitId ?? null,
          status: RequestStatus.OPEN,
          channel: body.channel ?? Channel.ONLINE,
          createdAt: filedAt,
          slaDueAt: routed.slaDueAt,
          address: body.address ?? null,
          zip: body.zip ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          // Ours, not New York's. This flag is what keeps the two populations
          // separable everywhere downstream.
          isImported: false,
        },
        include: REQUEST_INCLUDE,
      })

      await tx.requestStatusHistory.create({
        data: {
          requestId: request.id,
          fromStatus: null,
          toStatus: RequestStatus.OPEN,
          at: filedAt,
          actorId: req.user?.id ?? null,
        },
      })

      await audit.record(tx, {
        action: 'request.filed',
        entityType: 'request',
        entityId: request.id,
        payload: { srNumber, typeId: body.typeId, agencyId: routed.agencyId },
        actorId: req.user?.id ?? null,
        actorLabel: req.user?.name ?? 'anonymous',
      })

      // Whatever a later layer registered, inside this transaction. This route
      // does not know what that is — see services/requestHooks.ts.
      await runFiledHooks(tx, request)

      return request
    })

    // A new request changes its board's volume and backlog. The rollup is
    // cached (see routes/boards.ts), so tell it, and let it recompute now.
    invalidateBoards()
    warmBoards()
    res.status(201).json(publicRequest(created, referenceDate()))
  }),
)

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

const SORTS = {
  age: { createdAt: 'asc' },
  newest: { createdAt: 'desc' },
  due: { slaDueAt: 'asc' },
} as const satisfies Record<string, Prisma.ServiceRequestOrderByWithRelationInput>

const listSchema = z.object({
  agencyId: z.coerce.number().int().positive().optional(),
  orgUnitId: z.coerce.number().int().positive().optional(),
  typeId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(RequestStatus).optional(),
  /** Open requests only, in any of the not-closed states. */
  openOnly: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['age', 'newest', 'due']).default('age'),
})

/**
 * The agency queue.
 *
 * Agent-only and always paged. At 350,000 rows the temptation is to fetch and
 * filter in the client, which works fine against a seeded database of two
 * thousand and falls over the first time it meets the real corpus.
 *
 * `overdue` is a filter over `slaDueAt` against the **system reference date** —
 * the snapshot at which NYC's statuses were observed — never `Date.now()`. Asked
 * of the wall clock, every figure on this screen would describe a day the record
 * does not.
 */
requestsRouter.get(
  '/',
  authenticate,
  requireAgent,
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data
    const now = referenceDate()

    // ANDed as separate conditions, not spread into one object. Three filters
    // constrain `status` — an explicit status, "open only" and "overdue" — and
    // spreading them let the last silently overwrite the first: choosing Pending
    // with "open only" ticked returned every open request of any status.
    const conditions: Prisma.ServiceRequestWhereInput[] = [
      // An agent sees their own agency's work. Agency-level accountability is
      // the whole of Layer 0's access model — there is nothing finer to scope
      // to, because NYC records no individual ownership.
      { agencyId: q.agencyId ?? req.user!.agencyId ?? undefined },
    ]
    if (q.orgUnitId) conditions.push({ orgUnitId: q.orgUnitId })
    if (q.typeId) conditions.push({ typeId: q.typeId })
    if (q.status) conditions.push({ status: q.status })
    if (q.openOnly) conditions.push({ status: { not: RequestStatus.CLOSED } })
    // Open by NYC's status, as everywhere else — see publicRequest.
    if (q.overdue) {
      // Each record judged at its own observation time — see observedNow.
      conditions.push({
        status: { not: RequestStatus.CLOSED },
        OR: [
          { isImported: true, slaDueAt: { lt: now } },
          { isImported: false, slaDueAt: { lt: new Date() } },
        ],
      })
    }
    const where: Prisma.ServiceRequestWhereInput = { AND: conditions }

    const [rows, total] = await Promise.all([
      prisma.serviceRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: SORTS[q.sort],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.serviceRequest.count({ where }),
    ])

    res.json({
      rows: rows.map((r) => publicRequest(r, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      referenceDate: now,
    })
  }),
)

// ---------------------------------------------------------------------------
// Lookup and detail
// ---------------------------------------------------------------------------

/**
 * Public lookup by SR number. No authentication.
 *
 * NYC lets anyone check any service request by its number, and so do we. It is
 * also the single best demonstration that this system is running on real data:
 * any of the 355,430 imported numbers resolves.
 */
requestsRouter.get(
  '/:srNumber',
  asyncHandler(async (req, res) => {
    const srNumber = String(req.params.srNumber).trim().toUpperCase()
    const request = await prisma.serviceRequest.findUnique({
      where: { srNumber },
      include: REQUEST_INCLUDE,
    })
    if (!request) throw notFound('No request with that number')

    const history = await prisma.requestStatusHistory.findMany({
      where: { requestId: request.id },
      orderBy: { at: 'asc' },
      select: { id: true, fromStatus: true, toStatus: true, at: true, note: true },
    })

    res.json({
      ...publicRequest(request, referenceDate()),
      // One entry for an imported request: its arrival in the state NYC last
      // published. NYC publishes no status history, and inventing the steps in
      // between would be manufacturing a record of work nobody did.
      history,
      slaNote: request.type?.slaNote ?? null,
    })
  }),
)

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  status: z.nativeEnum(RequestStatus),
  note: z.string().max(2000).optional(),
})

/**
 * Move a request to a new status.
 *
 * Writes history and an audit entry in the same transaction as the update, so a
 * status the register shows always has a corresponding entry in the chain.
 */
requestsRouter.patch(
  '/:id/status',
  authenticate,
  requireAgent,
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('Invalid request id')
    const body = req.body as z.infer<typeof statusSchema>
    const at = new Date()

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.serviceRequest.findUnique({
        where: { id },
        select: { id: true, srNumber: true, status: true, agencyId: true, closedAt: true },
      })
      if (!existing) throw notFound('No such request')
      if (req.user!.agencyId !== null && existing.agencyId !== req.user!.agencyId) {
        throw forbidden('That request belongs to another agency')
      }
      if (existing.status === body.status) {
        throw badRequest('The request is already in that status')
      }

      const request = await tx.serviceRequest.update({
        where: { id },
        data: {
          status: body.status,
          resolutionNote: body.note ?? undefined,
          // Closing stamps a real time; reopening clears it, so "closed" and
          // "has a closedAt" can never disagree.
          closedAt:
            body.status === RequestStatus.CLOSED ? (existing.closedAt ?? at) : null,
        },
        include: REQUEST_INCLUDE,
      })

      await tx.requestStatusHistory.create({
        data: {
          requestId: id,
          fromStatus: existing.status,
          toStatus: body.status,
          at,
          actorId: req.user!.id,
          note: body.note ?? null,
        },
      })

      await audit.record(tx, {
        action: 'request.status_changed',
        entityType: 'request',
        entityId: id,
        payload: { srNumber: existing.srNumber, from: existing.status, to: body.status },
        actorId: req.user!.id,
        actorLabel: req.user!.name,
      })

      return request
    })

    // Closing or reopening moves a request between open and closed on its
    // board, so the cached rollup is now wrong until it recomputes.
    invalidateBoards()
    warmBoards()
    res.json(publicRequest(updated, referenceDate()))
  }),
)

/** A citizen's own requests. */
requestsRouter.get(
  '/mine/list',
  authenticate,
  asyncHandler(async (req, res) => {
    const rows = await prisma.serviceRequest.findMany({
      where: { citizenId: req.user!.id },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const now = referenceDate()
    res.json({ rows: rows.map((r) => publicRequest(r, now)), total: rows.length })
  }),
)
