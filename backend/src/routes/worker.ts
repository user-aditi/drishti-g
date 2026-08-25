/**
 * The field worker's job list.
 *
 * Deliberately the narrowest surface in the system. A safai karamchari or
 * lineman sees only the jobs allotted to them, and can do exactly two things:
 * say they have started, and say they have finished with a photograph. They
 * cannot resolve, close, reassign or reject anything — that is the Section
 * Officer's authority, and collapsing the two would remove the inspection step
 * that makes the whole chain worth having.
 *
 * The endpoints assume a phone on a patchy connection: small payloads, plain
 * language, no pagination.
 */
import { Router } from 'express'
import { ComplaintStatus, Rank } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireExactRank } from '../middleware/auth.js'
import { uploadPhoto, photoUrl } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { scheduleComplaintSync } from '../services/graphSync.js'
import { findResponsibleOfficer } from '../services/hierarchy.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'

export const workerRouter: Router = Router()

// Officers can look at a worker's view for support, but not act as them.
workerRouter.use(authenticate, requireExactRank(Rank.FIELD_WORKER, Rank.SUPER_ADMIN))

/** Trimmed shape — a worker needs the job, not the case file. */
const JOB_SELECT = {
  id: true,
  referenceNo: true,
  title: true,
  description: true,
  photoUrl: true,
  address: true,
  landmark: true,
  latitude: true,
  longitude: true,
  status: true,
  priority: true,
  slaDueAt: true,
  createdAt: true,
  category: { select: { name: true, nameHi: true, icon: true } },
  sector: { select: { id: true, number: true, name: true } },
  departmentId: true,
  sectorId: true,
} as const

/**
 * Who a worker answers to on the ground.
 *
 * Deliberately *not* the complaint's assignedOfficer. Escalation moves that
 * field up the chain, so a badly overdue job would tell the beldar they report
 * to a Superintending Engineer. In practice the Section Officer for their
 * sector remains their supervisor whatever is happening above them.
 */
async function supervisorFor(complaint: {
  departmentId: number | null
  sectorId: number | null
}): Promise<{ id: number; fullName: string; designationTitle: string | null } | null> {
  if (complaint.departmentId == null || complaint.sectorId == null) return null
  const officer = await findResponsibleOfficer(prisma, {
    departmentId: complaint.departmentId,
    sectorId: complaint.sectorId,
    rank: Rank.SECTION_OFFICER,
  })
  return officer
    ? { id: officer.userId, fullName: officer.fullName, designationTitle: officer.designationTitle }
    : null
}

workerRouter.get(
  '/jobs',
  validate(z.object({ scope: z.enum(['active', 'done']).default('active') }), 'query'),
  asyncHandler(async (req, res) => {
    const { scope } = req.query as unknown as { scope: 'active' | 'done' }
    const actor = req.user!

    const statuses =
      scope === 'done'
        ? [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED, ComplaintStatus.AWAITING_VERIFICATION]
        : [ComplaintStatus.IN_PROGRESS]

    const jobs = await prisma.complaint.findMany({
      where: { assignedWorkerId: actor.id, status: { in: statuses } },
      select: JOB_SELECT,
      orderBy: [{ priority: 'desc' }, { slaDueAt: { sort: 'asc', nulls: 'last' } }],
    })

    const now = Date.now()
    const items = await Promise.all(
      jobs.map(async ({ departmentId, sectorId, ...j }) => ({
        ...j,
        isOverdue: j.slaDueAt != null && j.slaDueAt.getTime() < now,
        hoursRemaining: j.slaDueAt != null ? Math.round((j.slaDueAt.getTime() - now) / 36e5) : null,
        supervisor: await supervisorFor({ departmentId, sectorId }),
      })),
    )
    res.json({ items, total: items.length })
  }),
)

/** One job, with the citizen's photo so the worker knows what to look for. */
workerRouter.get(
  '/jobs/:id',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const job = await prisma.complaint.findUnique({
      where: { id: Number(req.params.id) },
      select: { ...JOB_SELECT, assignedWorkerId: true },
    })
    if (!job) throw notFound('That job does not exist')
    if (job.assignedWorkerId !== req.user!.id && req.user!.rank !== Rank.SUPER_ADMIN) {
      throw forbidden('This job is not allotted to you')
    }
    const { departmentId, sectorId, ...rest } = job
    res.json({ ...rest, supervisor: await supervisorFor({ departmentId, sectorId }) })
  }),
)

/**
 * Report the job finished.
 *
 * Moves it to AWAITING_VERIFICATION, never straight to resolved — the officer
 * inspects before anything counts as done. A photograph is required, because
 * "completed" with no evidence is the failure mode this whole flow exists to
 * prevent.
 */
workerRouter.post(
  '/jobs/:id/complete',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  uploadPhoto,
  validate(z.object({ note: z.string().max(2000).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { note } = req.body as { note?: string }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That job does not exist')
    if (complaint.assignedWorkerId !== actor.id && actor.rank !== Rank.SUPER_ADMIN) {
      throw forbidden('This job is not allotted to you')
    }
    if (complaint.status !== ComplaintStatus.IN_PROGRESS) {
      throw badRequest('This job is not currently open for you to complete')
    }
    if (!req.file) {
      throw badRequest('Take a photo of the completed work before submitting')
    }

    const evidenceUrl = photoUrl(req.file.filename)

    await prisma.$transaction(async (tx) => {
      await tx.complaint.update({
        where: { id },
        data: { status: ComplaintStatus.AWAITING_VERIFICATION },
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: ComplaintStatus.IN_PROGRESS,
          toStatus: ComplaintStatus.AWAITING_VERIFICATION,
          actorId: actor.id,
          note: note ?? 'Work completed on site.',
          evidenceUrl,
        },
      })

      if (complaint.assignedOfficerId != null) {
        await tx.notification.create({
          data: {
            userId: complaint.assignedOfficerId,
            title: `Ready for inspection: ${complaint.referenceNo}`,
            body: `${actor.fullName} has reported the work complete and submitted a photograph.`,
            link: `/complaints/${id}`,
          },
        })
      }

      await audit.record(tx, {
        action: 'complaint.work_completed',
        entityType: 'complaint',
        entityId: id,
        payload: { note: note ?? null, hasEvidence: true },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    scheduleComplaintSync(id)

    res.json({
      id,
      status: ComplaintStatus.AWAITING_VERIFICATION,
      evidenceUrl,
      message: 'Submitted for inspection by your officer.',
    })
  }),
)

/** Report a problem that stops the work — the officer picks it up from here. */
workerRouter.post(
  '/jobs/:id/report-issue',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  uploadPhoto,
  validate(z.object({ note: z.string().min(5, 'Say what is blocking the work').max(2000) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { note } = req.body as { note: string }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That job does not exist')
    if (complaint.assignedWorkerId !== actor.id && actor.rank !== Rank.SUPER_ADMIN) {
      throw forbidden('This job is not allotted to you')
    }

    // The status does not move: the job is still theirs, the officer just needs
    // to know it is stuck.
    await prisma.$transaction(async (tx) => {
      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus: complaint.status,
          actorId: actor.id,
          note: `Issue reported by the crew: ${note}`,
          evidenceUrl: req.file ? photoUrl(req.file.filename) : null,
        },
      })

      if (complaint.assignedOfficerId != null) {
        await tx.notification.create({
          data: {
            userId: complaint.assignedOfficerId,
            title: `Crew blocked on ${complaint.referenceNo}`,
            body: `${actor.fullName}: ${note}`,
            link: `/complaints/${id}`,
          },
        })
      }

      await audit.record(tx, {
        action: 'complaint.issue_reported',
        entityType: 'complaint',
        entityId: id,
        payload: { note },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    res.json({ id, message: 'Your officer has been informed.' })
  }),
)
