import { Router } from 'express'
import { EscalationTrigger, Prisma, RequestStatus, Role } from '@prisma/client'
import { z } from 'zod'
import { referenceDate } from '../config/systemClock.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { escalate, LEVEL_NAME, TOP_LEVEL } from '../services/escalation.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { escalationView, LAYER2_INCLUDE, layer2Request } from '../utils/serializeLayer2.js'
import type { AuthUser } from '../types/express.js'

/**
 * Escalation. Layer 2 — nothing here exists in NYC 311.
 *
 * Mounted at the API root: the plan fixes the manual trigger at
 * `POST /requests/:id/escalate`, beside the request it acts on, while the
 * register lives at `/escalations`. Every route authenticates itself.
 */
export const escalationsRouter: Router = Router()

const SENIOR = [Role.SUPERVISOR, Role.COMMISSIONER]

/**
 * Who may raise a request one rung by hand: the officer who answers for it, or a
 * supervisor in its agency. Not the commissioner — they are the top rung, and
 * there is nowhere further to send it.
 */
function mayRaise(
  user: AuthUser,
  request: { agencyId: number; assignedOfficerId: number | null },
): boolean {
  if (user.role === Role.OFFICER) return request.assignedOfficerId === user.id
  if (user.role === Role.SUPERVISOR) return request.agencyId === user.agencyId
  return false
}

const listSchema = z.object({
  /** Exactly this rung. Omitted: every escalated request the viewer can see. */
  level: z.coerce.number().int().min(1).max(TOP_LEVEL).optional(),
  openOnly: z.enum(['true', 'false']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * The escalation register: requests in this agency that have climbed the ladder.
 *
 * Highest rung first, then closest to its deadline, because the question a
 * supervisor or commissioner brings to it is "what reached me that I have not
 * dealt with", and the top of that list is whatever has gone furthest.
 */
escalationsRouter.get(
  '/escalations',
  authenticate,
  requireRole(...SENIOR),
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data

    const where: Prisma.ServiceRequestWhereInput = {
      agencyId: req.user!.agencyId ?? -1,
      escalationLevel: q.level ? q.level : { gte: 1 },
      ...(q.openOnly === 'true' ? { status: { not: RequestStatus.CLOSED } } : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.serviceRequest.findMany({
        where,
        include: LAYER2_INCLUDE,
        orderBy: [{ escalationLevel: 'desc' }, { slaDueAt: { sort: 'asc', nulls: 'last' } }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.serviceRequest.count({ where }),
    ])
    const now = referenceDate()
    res.json({
      rows: rows.map((r) => layer2Request(r, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      referenceDate: now,
    })
  }),
)

/** One request's ladder, for the page that shows it. */
escalationsRouter.get(
  '/escalations/request/:srNumber',
  authenticate,
  requireRole(Role.OFFICER, ...SENIOR),
  asyncHandler(async (req, res) => {
    const srNumber = String(req.params.srNumber).trim().toUpperCase()
    const request = await prisma.serviceRequest.findUnique({
      where: { srNumber },
      include: {
        escalations: LAYER2_INCLUDE.escalations,
      },
    })
    if (!request) throw notFound('No request with that number')

    const user = req.user!
    const visible =
      user.role === Role.OFFICER
        ? request.assignedOfficerId === user.id
        : request.agencyId === user.agencyId
    if (!visible) throw forbidden('This request is not yours to see')

    const open = request.status !== RequestStatus.CLOSED
    res.json({
      srNumber: request.srNumber,
      requestId: request.id,
      status: request.status,
      escalationLevel: request.escalationLevel,
      escalationLevelName: LEVEL_NAME[request.escalationLevel],
      nextLevelName: request.escalationLevel < TOP_LEVEL ? LEVEL_NAME[request.escalationLevel + 1] : null,
      canEscalate: open && request.escalationLevel < TOP_LEVEL && mayRaise(user, request),
      escalations: request.escalations.map(escalationView),
    })
  }),
)

const raiseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Say why — the person it reaches will act on this sentence')
    .max(1000),
})

/**
 * Raise a request one rung by hand.
 *
 * Allowed before any breach. The gate — "fires on breach and only on breach" —
 * governs the automatic trigger; a person who can see a request going wrong
 * should not have to wait for its deadline to say so. What a manual escalation
 * must carry instead is a reason, because that sentence is all the senior person
 * it reaches has to act on.
 */
escalationsRouter.post(
  '/requests/:id/escalate',
  authenticate,
  requireRole(Role.OFFICER, Role.SUPERVISOR),
  validate(raiseSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('Invalid request id')
    const { reason } = req.body as z.infer<typeof raiseSchema>
    const user = req.user!

    const request = await prisma.serviceRequest.findUnique({ where: { id } })
    if (!request) throw notFound('No such request')
    if (!mayRaise(user, request)) {
      throw forbidden('Only the officer who answers for this request, or its agency’s supervisor, can escalate it')
    }
    if (request.status === RequestStatus.CLOSED) throw badRequest('That request is closed')
    if (request.escalationLevel >= TOP_LEVEL) {
      throw badRequest('That request is already with the borough commissioner')
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        await escalate(tx, {
          requestId: id,
          agencyId: request.agencyId,
          fromLevel: request.escalationLevel,
          toLevel: request.escalationLevel + 1,
          trigger: EscalationTrigger.MANUAL,
          reason,
          raisedById: user.id,
          raisedByLabel: user.name,
          at: new Date(),
        })
        return tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: LAYER2_INCLUDE })
      })
      res.json(layer2Request(updated, referenceDate()))
    } catch (err) {
      // The sweep reached this rung between the read above and the write.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw badRequest('That request has just reached this rung; refresh to see who has it')
      }
      throw err
    }
  }),
)
