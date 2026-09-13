import { Router } from 'express'
import { Prisma, RequestStatus, Role } from '@prisma/client'
import { z } from 'zod'
import { referenceDate } from '../config/systemClock.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { changeStatus } from '../services/status.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { LAYER1_INCLUDE, layer1Request } from '../utils/serializeLayer1.js'
import { invalidateBoards, warmBoards } from './boards.js'

/**
 * The officer's desk. Layer 1 — nothing here exists in NYC 311.
 */
export const officerRouter: Router = Router()

const deskSchema = z.object({
  /** Open requests only by default: the desk is for what still needs doing. */
  scope: z.enum(['open', 'all']).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * The requests this officer personally answers for, most urgent first.
 *
 * Ordered by derived deadline rather than by age. An agency queue sorts by age
 * because it is a backlog shared by everyone; a desk is one person's list, and
 * the question it answers is "what do I do next", which is whatever is closest
 * to being late. Against a historical snapshot almost all of it is already late
 * (see systemClock.ts), and the order then runs from most to least overdue.
 */
officerRouter.get(
  '/desk',
  authenticate,
  requireRole(Role.OFFICER),
  asyncHandler(async (req, res) => {
    const parsed = deskSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data
    const now = referenceDate()

    const where: Prisma.ServiceRequestWhereInput = {
      assignedOfficerId: req.user!.id,
      ...(q.scope === 'open' ? { status: { not: RequestStatus.CLOSED } } : {}),
    }

    const [rows, total, overdue] = await Promise.all([
      prisma.serviceRequest.findMany({
        where,
        include: LAYER1_INCLUDE,
        orderBy: [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.serviceRequest.count({ where }),
      prisma.serviceRequest.count({
        where: {
          assignedOfficerId: req.user!.id,
          status: { not: RequestStatus.CLOSED },
          OR: [
            { isImported: true, slaDueAt: { lt: now } },
            { isImported: false, slaDueAt: { lt: new Date() } },
          ],
        },
      }),
    ])

    res.json({
      rows: rows.map((r) => layer1Request(r, now)),
      total,
      overdue,
      page: q.page,
      pageSize: q.pageSize,
      referenceDate: now,
    })
  }),
)

/**
 * One request as its accountable officer sees it, with its work orders.
 *
 * Open to the officer who holds it and to their agency's supervisors — the
 * people who answer for it — and to nobody else in Layer 1.
 */
officerRouter.get(
  '/requests/:srNumber',
  authenticate,
  requireRole(Role.OFFICER, Role.SUPERVISOR),
  asyncHandler(async (req, res) => {
    const srNumber = String(req.params.srNumber).trim().toUpperCase()
    const request = await prisma.serviceRequest.findUnique({
      where: { srNumber },
      include: LAYER1_INCLUDE,
    })
    if (!request) throw notFound('No request with that number')

    const user = req.user!
    const allowed =
      user.role === Role.OFFICER
        ? request.assignedOfficerId === user.id
        : request.agencyId === user.agencyId
    if (!allowed) throw forbidden('This request is not assigned to you')

    const history = await prisma.requestStatusHistory.findMany({
      where: { requestId: request.id },
      orderBy: { at: 'asc' },
      select: { id: true, fromStatus: true, toStatus: true, at: true, note: true },
    })

    res.json({
      ...layer1Request(request, referenceDate()),
      history,
      slaNote: request.type.slaNote,
    })
  }),
)

const statusSchema = z.object({
  status: z.nativeEnum(RequestStatus),
  note: z.string().max(2000).optional(),
})

/**
 * Change a request's status as the person who answers for it — above all, close
 * it.
 *
 * Before Phase 9 only an agent could. The officer could assign a crew, receive
 * its photographs and accept the work, and then had no way to close the request
 * the work was for: the crew page said "the officer will close the request" and
 * the verification page said "close it on the request itself", which offered no
 * such control.
 *
 * The transition is Layer 0's shared one, so the history row, the audit entry
 * and the closedAt rule are identical whoever makes the change. What differs is
 * who may: the officer the request is assigned to, or a supervisor of its
 * agency.
 */
officerRouter.patch(
  '/requests/:id/status',
  authenticate,
  requireRole(Role.OFFICER, Role.SUPERVISOR),
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('Invalid request id')
    const body = req.body as z.infer<typeof statusSchema>
    const user = req.user!

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.serviceRequest.findUnique({
        where: { id },
        select: { agencyId: true, assignedOfficerId: true },
      })
      if (!existing) throw notFound('No such request')
      const allowed =
        user.role === Role.OFFICER
          ? existing.assignedOfficerId === user.id
          : existing.agencyId === user.agencyId
      if (!allowed) {
        throw forbidden(
          'Only the officer who answers for this request, or its agency\u2019s supervisor, can change its status',
        )
      }
      await changeStatus(tx, {
        requestId: id,
        status: body.status,
        note: body.note,
        actorId: user.id,
        actorLabel: user.name,
      })
      return tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: LAYER1_INCLUDE })
    })

    invalidateBoards()
    warmBoards()
    res.json(layer1Request(updated, referenceDate()))
  }),
)

