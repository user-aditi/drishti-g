/**
 * The field official's task inbox.
 *
 * Same complaints, different lens: an official cares about what is due, in what
 * order, and what they must do next — not about browsing the whole city.
 */
import { Router } from 'express'
import { ComplaintStatus, Prisma, UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { uploadPhoto, photoUrl } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { ALLOWED_TRANSITIONS, canTransition } from '../services/gcce.js'
import { scheduleComplaintSync } from '../services/graphSync.js'
import { scheduleWardRescore } from '../services/riskSignals.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { publicComplaint } from '../utils/serialize.js'

export const tasksRouter: Router = Router()

tasksRouter.use(authenticate, requireRole(UserRole.FIELD_OFFICIAL, UserRole.ADMIN))

const includeRelations = {
  category: true,
  department: true,
  ward: true,
  citizen: true,
  assignedTo: true,
} satisfies Prisma.ComplaintInclude

const ACTIVE: ComplaintStatus[] = [
  ComplaintStatus.ROUTED,
  ComplaintStatus.ASSIGNED,
  ComplaintStatus.IN_PROGRESS,
]

/**
 * The inbox, ordered by urgency.
 *
 * Overdue first, then by deadline, then by priority — an official opening the
 * app should see the thing that is most late at the top without filtering.
 */
tasksRouter.get(
  '/',
  validate(
    z.object({
      scope: z.enum(['active', 'all', 'done']).default('active'),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { scope } = req.query as unknown as { scope: 'active' | 'all' | 'done' }
    const actor = req.user!

    const where: Prisma.ComplaintWhereInput = { assignedToId: actor.id }
    if (scope === 'active') where.status = { in: ACTIVE }
    if (scope === 'done') {
      where.status = { in: [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED] }
    }

    const tasks = await prisma.complaint.findMany({
      where,
      include: includeRelations,
      // Nulls last so a task with no deadline never outranks a real one.
      orderBy: [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { createdAt: 'asc' }],
    })

    const now = Date.now()
    res.json({
      items: tasks.map((t) => ({
        ...publicComplaint(t),
        isOverdue:
          t.slaDueAt != null && ACTIVE.includes(t.status) && t.slaDueAt.getTime() < now,
        hoursRemaining:
          t.slaDueAt != null ? Math.round((t.slaDueAt.getTime() - now) / 36e5) : null,
        /** What this task may become next, so the UI need not duplicate the rules. */
        nextStatuses: ALLOWED_TRANSITIONS[t.status],
      })),
      total: tasks.length,
    })
  }),
)

const updateSchema = z.object({
  toStatus: z.nativeEnum(ComplaintStatus),
  note: z.string().max(2000).optional(),
})

/**
 * Advance a task, optionally with photographic evidence.
 *
 * Transitions are checked against GCCE's state machine rather than trusted from
 * the client, so a task cannot jump from assigned straight to closed.
 */
tasksRouter.post(
  '/:id/status',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  uploadPhoto,
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { toStatus, note } = req.body as z.infer<typeof updateSchema>
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That task does not exist')
    if (complaint.assignedToId !== actor.id && actor.role !== UserRole.ADMIN) {
      throw forbidden('This task is not assigned to you')
    }

    if (!canTransition(complaint.status, toStatus)) {
      const allowed = ALLOWED_TRANSITIONS[complaint.status]
      const current = complaint.status.toLowerCase().replace('_', ' ')
      const article = /^[aeiou]/.test(current) ? 'An' : 'A'
      throw badRequest(
        allowed.length === 0
          ? `This complaint is ${current} and can no longer be changed`
          : `${article} ${current} complaint can only move to: ${allowed
              .join(', ')
              .toLowerCase()
              .replace(/_/g, ' ')}`,
      )
    }

    // Resolving is the claim that the work is done, so evidence is required.
    const evidenceUrl = req.file ? photoUrl(req.file.filename) : null
    if (toStatus === ComplaintStatus.RESOLVED && !evidenceUrl) {
      throw badRequest('Attach a photo of the completed work before marking this resolved')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: {
          status: toStatus,
          resolvedAt: toStatus === ComplaintStatus.RESOLVED ? new Date() : complaint.resolvedAt,
        },
        include: includeRelations,
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus,
          actorId: actor.id,
          note: note ?? null,
          evidenceUrl,
        },
      })

      const message =
        toStatus === ComplaintStatus.IN_PROGRESS
          ? 'Work has started on your complaint.'
          : toStatus === ComplaintStatus.RESOLVED
            ? 'Your complaint has been resolved. Please take a look and let us know.'
            : `Your complaint is now ${toStatus.toLowerCase().replace('_', ' ')}.`

      await tx.notification.create({
        data: {
          userId: complaint.citizenId,
          title: `Update on ${complaint.referenceNo}`,
          body: message,
          link: `/complaints/${id}`,
        },
      })

      await audit.record(tx, {
        action: 'complaint.status_changed',
        entityType: 'complaint',
        entityId: id,
        payload: {
          from: complaint.status,
          to: toStatus,
          hasEvidence: Boolean(evidenceUrl),
          note: note ?? null,
        },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return saved
    })

    scheduleComplaintSync(id)
    if (updated.wardId != null) scheduleWardRescore(updated.wardId)

    res.json(publicComplaint(updated))
  }),
)
