/**
 * The Section Officer's desk.
 *
 * A Junior Engineer / Sanitary Inspector does three things here: sees what has
 * landed on them, puts a member of their crew on the job, and inspects the work
 * when the crew says it is done. That middle step is the one a naive complaint
 * app leaves out, and it is where most of the real accountability sits.
 */
import { Router } from 'express'
import { ComplaintStatus, Rank } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireOfficer } from '../middleware/auth.js'
import { uploadPhoto } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { ALLOWED_TRANSITIONS, OPEN_STATUSES, canTransition } from '../services/gcce.js'
import { scheduleComplaintSync } from '../services/graphSync.js'
import { hasJurisdiction, workersForSector } from '../services/hierarchy.js'
import { scheduleSectorRescore } from '../services/riskSignals.js'
import { asyncHandler, badRequest, forbidden, notFound, unprocessable } from '../utils/http.js'
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
      include: COMPLAINT_INCLUDE,
      orderBy: [
        { escalationLevel: 'desc' },
        { slaDueAt: { sort: 'asc', nulls: 'last' } },
        { priority: 'desc' },
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
        needsAllotment: c.status === ComplaintStatus.ASSIGNED && c.assignedWorkerId == null,
      })),
      total: complaints.length,
    })
  }),
)

/**
 * The crew this officer can put on a job.
 *
 * Scoped to the complaint's own sector and department, and narrowed to the
 * trade the category calls for — a lineman is not sent to clear a drain.
 */
officerRouter.get(
  '/complaints/:id/workers',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const complaint = await prisma.complaint.findUnique({
      where: { id: Number(req.params.id) },
      include: { category: true },
    })
    if (!complaint) throw notFound('That complaint does not exist')
    if (complaint.departmentId == null || complaint.sectorId == null) {
      throw unprocessable('This complaint has not been routed to a department and sector yet')
    }

    const permitted = await hasJurisdiction(prisma, req.user!, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')

    const preferred = await workersForSector(prisma, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
      trade: complaint.category?.trade ?? null,
    })

    // If nobody of the right trade is posted here, offer the whole sector crew
    // rather than an empty list — a blocked officer is worse than an imperfect
    // match they can override.
    const items =
      preferred.length > 0
        ? preferred
        : await workersForSector(prisma, {
            departmentId: complaint.departmentId,
            sectorId: complaint.sectorId,
          })

    res.json({
      items,
      preferredTrade: complaint.category?.trade ?? null,
      exactTradeAvailable: preferred.length > 0,
    })
  }),
)

/** Allot the job to a member of the sector crew. */
officerRouter.post(
  '/complaints/:id/allot',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      workerId: z.number().int().positive(),
      instructions: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { workerId, instructions } = req.body as { workerId: number; instructions?: string }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')

    if (!canTransition(complaint.status, ComplaintStatus.IN_PROGRESS)) {
      throw badRequest(
        `A complaint that is ${complaint.status.toLowerCase().replace(/_/g, ' ')} cannot be allotted to a worker`,
      )
    }

    // The worker must actually be posted to this sector and department —
    // otherwise an officer could hand work to someone else's crew.
    const posting = await prisma.posting.findFirst({
      where: {
        userId: workerId,
        rank: Rank.FIELD_WORKER,
        departmentId: complaint.departmentId,
        sectorId: complaint.sectorId,
        endedAt: null,
        user: { isActive: true },
      },
      include: { user: true },
    })
    if (!posting) {
      throw unprocessable('That worker is not posted to this sector for this department')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { assignedWorkerId: workerId, status: ComplaintStatus.IN_PROGRESS },
        include: COMPLAINT_INCLUDE,
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus: ComplaintStatus.IN_PROGRESS,
          actorId: actor.id,
          note: instructions
            ? `Allotted to ${posting.user.fullName}. ${instructions}`
            : `Allotted to ${posting.user.fullName}.`,
        },
      })

      await tx.notification.createMany({
        data: [
          {
            userId: workerId,
            title: `New job: ${complaint.title}`,
            body: `${complaint.referenceNo} has been allotted to you${instructions ? `. ${instructions}` : '.'}`,
            link: `/jobs/${id}`,
          },
          {
            userId: complaint.citizenId,
            title: `Update on ${complaint.referenceNo}`,
            body: 'Work has been allotted to a field crew and will begin shortly.',
            link: `/complaints/${id}`,
          },
        ],
      })

      await audit.record(tx, {
        action: 'complaint.allotted',
        entityType: 'complaint',
        entityId: id,
        payload: { workerId, workerName: posting.user.fullName, instructions: instructions ?? null },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return saved
    })

    scheduleComplaintSync(id)
    res.json(publicComplaint(updated))
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

    scheduleComplaintSync(id)
    if (updated.sectorId != null) scheduleSectorRescore(updated.sectorId)

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

    scheduleComplaintSync(id)
    if (updated.sectorId != null) scheduleSectorRescore(updated.sectorId)

    res.json(publicComplaint(updated))
  }),
)
