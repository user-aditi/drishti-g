/**
 * The Section Officer's desk.
 *
 * A Junior Engineer / Sanitary Inspector does three things here: sees what has
 * landed on them, puts a member of their crew on the job, and inspects the work
 * when the crew says it is done. That middle step is the one a naive complaint
 * app leaves out, and it is where most of the real accountability sits.
 */
import { Router } from 'express'
import { ComplaintStatus, WorkOrderStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireOfficer } from '../middleware/auth.js'
import { uploadPhoto } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { ALLOWED_TRANSITIONS, OPEN_STATUSES, canTransition } from '../services/gcce.js'
import { hasJurisdiction } from '../services/hierarchy.js'
import { scheduleUnitRescore } from '../services/riskSignals.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { COMPLAINT_INCLUDE, publicComplaint } from '../utils/serialize.js'

export const officerRouter: Router = Router()

officerRouter.use(authenticate, requireOfficer)

/**
 * The officer's desk, ordered by urgency.
 *
 * Escalated first, then overdue, then by deadline — an officer opening the app
 * should see what is most on fire without filtering.
 */
officerRouter.get(
  '/desk',
  validate(
    z.object({ scope: z.enum(['active', 'awaiting', 'done']).default('active') }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { scope } = req.query as unknown as { scope: 'active' | 'awaiting' | 'done' }
    const actor = req.user!

    const statuses =
      scope === 'awaiting'
        ? [ComplaintStatus.AWAITING_VERIFICATION]
        : scope === 'done'
          ? [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED]
          : OPEN_STATUSES

    const complaints = await prisma.complaint.findMany({
      where: { assignedOfficerId: actor.id, status: { in: statuses } },
      include: {
        ...COMPLAINT_INCLUDE,
        cluster: true,
        workOrders: {
          where: { status: { in: [WorkOrderStatus.ISSUED, WorkOrderStatus.OPENED] } },
          orderBy: { issuedAt: 'desc' },
          take: 1,
          include: { crew: { select: { id: true, fullName: true, trade: true, phone: true } } },
        },
      },
      // The computed urgency leads, because that is the whole point of having
      // computed it. Everything after it is a tie-break.
      orderBy: [
        { priorityScore: { sort: 'desc', nulls: 'last' } },
        { slaDueAt: { sort: 'asc', nulls: 'last' } },
      ],
    })

    const now = Date.now()
    res.json({
      items: complaints.map((c) => ({
        ...publicComplaint(c),
        isOverdue: c.slaDueAt != null && OPEN_STATUSES.includes(c.status) && c.slaDueAt.getTime() < now,
        hoursRemaining: c.slaDueAt != null ? Math.round((c.slaDueAt.getTime() - now) / 36e5) : null,
        /** What this may become next, so the UI need not duplicate the rules. */
        nextStatuses: ALLOWED_TRANSITIONS[c.status],
        /** True when nobody is out on this job yet — no live code exists. */
        needsAllotment:
          c.status === ComplaintStatus.ASSIGNED && c.workOrders.length === 0,
        /** The code currently out in the field, if there is one. */
        activeWorkOrder: c.workOrders[0]
          ? {
              id: c.workOrders[0].id,
              code: c.workOrders[0].code,
              status: c.workOrders[0].status,
              issuedAt: c.workOrders[0].issuedAt,
              openedAt: c.workOrders[0].openedAt,
              expiresAt: c.workOrders[0].expiresAt,
              crew: c.workOrders[0].crew,
            }
          : null,
        priorityScore: c.priorityScore,
        priorityFactors: c.priorityFactors,
        cluster: c.cluster
          ? { id: c.cluster.id, label: c.cluster.label, size: c.cluster.size }
          : null,
      })),
      total: complaints.length,
    })
  }),
)

/**
 * Inspect completed work: accept it, or send it back to the crew.
 *
 * This is the check that stops "resolved" from meaning "the worker said so".
 */
officerRouter.post(
  '/complaints/:id/verify',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      accept: z.boolean(),
      note: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { accept, note } = req.body as { accept: boolean; note?: string }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')
    if (complaint.status !== ComplaintStatus.AWAITING_VERIFICATION) {
      throw badRequest('There is no completed work waiting to be inspected on this complaint')
    }

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')

    if (!accept && !note) {
      throw badRequest('Explain what is wrong with the work before sending it back')
    }

    const toStatus = accept ? ComplaintStatus.RESOLVED : ComplaintStatus.IN_PROGRESS

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { status: toStatus, resolvedAt: accept ? new Date() : null },
        include: COMPLAINT_INCLUDE,
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus,
          actorId: actor.id,
          note: accept
            ? (note ?? 'Inspected on site and accepted.')
            : `Sent back to the crew. ${note}`,
        },
      })

      const recipients = [
        {
          userId: complaint.citizenId,
          title: `Update on ${complaint.referenceNo}`,
          body: accept
            ? 'The work has been inspected and your complaint is resolved. Please tell us how we did.'
            : 'The reported work did not pass inspection and has been sent back to the crew.',
          link: `/complaints/${id}`,
        },
      ]
      if (complaint.assignedWorkerId != null && !accept) {
        recipients.push({
          userId: complaint.assignedWorkerId,
          title: `Rework needed: ${complaint.referenceNo}`,
          body: note ?? 'The work did not pass inspection.',
          link: `/jobs/${id}`,
        })
      }
      await tx.notification.createMany({ data: recipients })

      await audit.record(tx, {
        action: accept ? 'complaint.verified' : 'complaint.rework',
        entityType: 'complaint',
        entityId: id,
        payload: { accept, note: note ?? null },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return saved
    })

    if (updated.orgUnitId != null) scheduleUnitRescore(updated.orgUnitId)

    res.json(publicComplaint(updated))
  }),
)

/** Reject a complaint outright, or mark it a repeat of an earlier one. */
officerRouter.post(
  '/complaints/:id/dispose',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  uploadPhoto,
  validate(
    z.object({
      outcome: z.enum([ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE]),
      reason: z.string().min(5, 'Give a reason the citizen can read').max(2000),
      duplicateOfId: z.coerce.number().int().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { outcome, reason, duplicateOfId } = req.body as {
      outcome: ComplaintStatus
      reason: string
      duplicateOfId?: number
    }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')

    if (!canTransition(complaint.status, outcome)) {
      throw badRequest(
        `A complaint that is ${complaint.status.toLowerCase().replace(/_/g, ' ')} cannot be marked ${outcome.toLowerCase()}`,
      )
    }
    if (outcome === ComplaintStatus.DUPLICATE && duplicateOfId == null) {
      throw badRequest('Say which complaint this duplicates')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { status: outcome, duplicateOfId: duplicateOfId ?? null, closedAt: new Date() },
        include: COMPLAINT_INCLUDE,
      })
      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus: outcome,
          actorId: actor.id,
          note: reason,
        },
      })
      await tx.notification.create({
        data: {
          userId: complaint.citizenId,
          title: `Update on ${complaint.referenceNo}`,
          body:
            outcome === ComplaintStatus.DUPLICATE
              ? `This has been linked to an earlier report of the same issue. ${reason}`
              : `Your complaint was closed without action. ${reason}`,
          link: `/complaints/${id}`,
        },
      })
      await audit.record(tx, {
        action: 'complaint.disposed',
        entityType: 'complaint',
        entityId: id,
        payload: { outcome, reason, duplicateOfId: duplicateOfId ?? null },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    if (updated.orgUnitId != null) scheduleUnitRescore(updated.orgUnitId)

    res.json(publicComplaint(updated))
  }),
)
