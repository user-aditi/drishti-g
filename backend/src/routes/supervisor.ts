import { Router } from 'express'
import { AssignmentSource, RequestStatus, Role } from '@prisma/client'
import { z } from 'zod'
import { referenceDate } from '../config/systemClock.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { assign, isEligible } from '../services/assignment.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { LAYER1_INCLUDE, layer1Request } from '../utils/serializeLayer1.js'

/**
 * Assignment by hand. Layer 1 — nothing here exists in NYC 311.
 *
 * Mounted at the API root because the plan fixes the assign endpoint at
 * `POST /requests/:id/assign`, beside the Layer 0 routes it acts on, while the
 * supervisor's own screens live under `/supervisor`. Every route authenticates
 * itself, so sitting at the root opens nothing.
 */
export const supervisorRouter: Router = Router()

const requireSupervisor = requireRole(Role.SUPERVISOR)

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * Open requests in this agency that nobody answers for.
 *
 * After the backfill this should be empty, and that is the point of showing it:
 * the gate is that every open request has exactly one accountable person, and
 * anything here is a counterexample — usually a board with nobody posted to it.
 */
supervisorRouter.get(
  '/supervisor/unassigned',
  authenticate,
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const q = pageSchema.parse(req.query)
    const where = {
      agencyId: req.user!.agencyId ?? -1,
      status: { not: RequestStatus.CLOSED },
      assignedOfficerId: null,
    }
    const [rows, total] = await Promise.all([
      prisma.serviceRequest.findMany({
        where,
        include: LAYER1_INCLUDE,
        orderBy: { createdAt: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.serviceRequest.count({ where }),
    ])
    const now = referenceDate()
    res.json({
      rows: rows.map((r) => layer1Request(r, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      referenceDate: now,
    })
  }),
)

/** The officers this supervisor can assign to, with where they sit and what they hold. */
supervisorRouter.get(
  '/supervisor/officers',
  authenticate,
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const agencyId = req.user!.agencyId ?? -1
    const officers = await prisma.user.findMany({
      where: {
        role: Role.OFFICER,
        isActive: true,
        postings: { some: { agencyId, endedAt: null } },
      },
      include: {
        postings: {
          where: { agencyId, endedAt: null },
          include: { orgUnit: { select: { id: true, code: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    })

    const loads = await prisma.serviceRequest.groupBy({
      by: ['assignedOfficerId'],
      where: {
        assignedOfficerId: { in: officers.map((o) => o.id) },
        status: { not: RequestStatus.CLOSED },
      },
      _count: { _all: true },
    })
    const load = new Map(loads.map((l) => [l.assignedOfficerId!, l._count._all]))

    res.json(
      officers.map((officer) => ({
        id: officer.id,
        name: officer.name,
        isSynthetic: officer.isSynthetic,
        units: officer.postings.map((p) => p.orgUnit),
        openLoad: load.get(officer.id) ?? 0,
      })),
    )
  }),
)

const assignSchema = z.object({ officerId: z.number().int().positive() })

/**
 * Hand a request to a named officer.
 *
 * Refused across agencies and to anyone not posted to the request's board or
 * the borough, because an assignment the officer cannot act on is worse than
 * none: it makes the coverage figure true while leaving the request unowned.
 */
supervisorRouter.post(
  '/requests/:id/assign',
  authenticate,
  requireSupervisor,
  validate(assignSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('Invalid request id')
    const { officerId } = req.body as z.infer<typeof assignSchema>
    const supervisor = req.user!

    const request = await prisma.serviceRequest.findUnique({ where: { id } })
    if (!request) throw notFound('No such request')
    if (request.agencyId !== supervisor.agencyId) {
      throw forbidden('That request belongs to another agency')
    }
    if (request.status === RequestStatus.CLOSED) {
      throw badRequest('That request is closed; there is nothing left to answer for')
    }
    if (request.assignedOfficerId === officerId) {
      throw badRequest('That officer already holds this request')
    }
    if (!(await isEligible(prisma, officerId, request))) {
      throw badRequest('That officer is not posted to this request’s board or borough')
    }

    const updated = await prisma.$transaction(async (tx) => {
      await assign(tx, {
        requestId: id,
        officerId,
        byUserId: supervisor.id,
        byLabel: supervisor.name,
        source: AssignmentSource.SUPERVISOR,
      })
      return tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: LAYER1_INCLUDE })
    })

    res.json(layer1Request(updated, referenceDate()))
  }),
)
