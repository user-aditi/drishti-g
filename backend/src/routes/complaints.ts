/**
 * Complaint filing and tracking.
 *
 * Filing is where GCCE runs: the citizen supplies what they saw, and everything
 * else — category, ward, department, assignee, priority, deadline — is decided
 * by the engine and recorded with its reasoning.
 */
import { Router } from 'express'
import { ComplaintStatus, Prisma, UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { uploadPhoto, photoUrl } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { canTransition, routeComplaint } from '../services/gcce.js'
import { scheduleComplaintSync } from '../services/graphSync.js'
import { scheduleWardRescore } from '../services/riskSignals.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { publicComplaint, referenceNoFor } from '../utils/serialize.js'

export const complaintsRouter: Router = Router()

complaintsRouter.use(authenticate)

const createSchema = z.object({
  title: z.string().min(5, 'Give your complaint a short title').max(200),
  description: z.string().min(10, 'Describe the issue in a little more detail').max(4000),
  categoryId: z.coerce.number().int().positive().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
})

const listSchema = z.object({
  status: z.nativeEnum(ComplaintStatus).optional(),
  wardId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
})

const includeRelations = {
  category: true,
  department: true,
  ward: true,
  citizen: true,
  assignedTo: true,
} satisfies Prisma.ComplaintInclude

/**
 * File a complaint.
 *
 * The row is created first so its id can seed the reference number, then GCCE
 * routes it. Both happen in one transaction — a complaint that exists but was
 * never routed would sit invisible to every inbox.
 */
complaintsRouter.post(
  '/',
  requireRole(UserRole.CITIZEN, UserRole.ADMIN),
  uploadPhoto,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>
    const actor = req.user!

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.complaint.create({
        data: {
          referenceNo: 'PENDING',
          citizenId: actor.id,
          title: body.title,
          description: body.description,
          categoryId: body.categoryId ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          address: body.address ?? null,
          photoUrl: req.file ? photoUrl(req.file.filename) : null,
        },
      })

      const complaint = await tx.complaint.update({
        where: { id: created.id },
        data: { referenceNo: referenceNoFor(created.id, created.createdAt) },
      })

      await audit.record(tx, {
        action: 'complaint.filed',
        entityType: 'complaint',
        entityId: complaint.id,
        payload: { referenceNo: complaint.referenceNo, title: complaint.title },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      const decision = await routeComplaint(tx, complaint, actor)

      const full = await tx.complaint.findUniqueOrThrow({
        where: { id: complaint.id },
        include: includeRelations,
      })
      return { complaint: full, decision }
    })

    // Fired after the transaction commits so neither can roll it back.
    scheduleComplaintSync(result.complaint.id)
    if (result.decision.wardId != null) scheduleWardRescore(result.decision.wardId)

    res.status(201).json({
      complaint: publicComplaint(result.complaint),
      routing: result.decision,
    })
  }),
)

/**
 * List complaints, scoped to what the caller is allowed to see.
 *
 * Scoping happens here rather than in the UI: a citizen must not be able to read
 * another citizen's complaints by editing a query string.
 */
complaintsRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { status, wardId, departmentId, q, page, size } = req.query as unknown as z.infer<
      typeof listSchema
    >
    const actor = req.user!

    const where: Prisma.ComplaintWhereInput = {}
    if (actor.role === UserRole.CITIZEN) where.citizenId = actor.id
    else if (actor.role === UserRole.FIELD_OFFICIAL) where.assignedToId = actor.id

    if (status) where.status = status
    if (wardId) where.wardId = wardId
    if (departmentId) where.departmentId = departmentId
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { referenceNo: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        include: includeRelations,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.complaint.count({ where }),
    ])

    res.json({ items: items.map(publicComplaint), total, page, size })
  }),
)

/** Counts by status for the caller's own scope — drives the dashboard tiles. */
complaintsRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const where: Prisma.ComplaintWhereInput = {}
    if (actor.role === UserRole.CITIZEN) where.citizenId = actor.id
    else if (actor.role === UserRole.FIELD_OFFICIAL) where.assignedToId = actor.id

    const grouped = await prisma.complaint.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })

    const byStatus = Object.fromEntries(
      Object.values(ComplaintStatus).map((s) => [s, 0]),
    ) as Record<ComplaintStatus, number>
    for (const row of grouped) byStatus[row.status] = row._count._all

    const open =
      byStatus.SUBMITTED + byStatus.ROUTED + byStatus.ASSIGNED + byStatus.IN_PROGRESS
    const overdue = await prisma.complaint.count({
      where: {
        ...where,
        slaDueAt: { lt: new Date() },
        status: { in: [ComplaintStatus.SUBMITTED, ComplaintStatus.ROUTED, ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS] },
      },
    })

    res.json({
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      open,
      resolved: byStatus.RESOLVED + byStatus.CLOSED,
      overdue,
    })
  }),
)

/** Anyone may see a complaint they are party to; admins see everything. */
async function loadVisibleComplaint(id: number, actor: Express.Request['user']) {
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      ...includeRelations,
      history: {
        include: { actor: { select: { id: true, fullName: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!complaint) throw notFound('That complaint does not exist')

  const isOwner = complaint.citizenId === actor!.id
  const isAssignee = complaint.assignedToId === actor!.id
  if (actor!.role !== UserRole.ADMIN && !isOwner && !isAssignee) {
    throw forbidden('You do not have access to this complaint')
  }
  return complaint
}

complaintsRouter.get(
  '/:id',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const complaint = await loadVisibleComplaint(Number(req.params.id), req.user)
    res.json({
      ...publicComplaint(complaint),
      history: complaint.history.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        evidenceUrl: h.evidenceUrl,
        createdAt: h.createdAt,
        actor: h.actor ? { id: h.actor.id, fullName: h.actor.fullName, role: h.actor.role } : null,
      })),
    })
  }),
)

/** Citizen feedback, accepted only once the work is actually done. */
complaintsRouter.post(
  '/:id/feedback',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(1000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { rating, comment } = req.body as { rating: number; comment?: string }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')
    if (complaint.citizenId !== actor.id) {
      throw forbidden('Only the person who filed a complaint can rate it')
    }
    if (complaint.status !== ComplaintStatus.RESOLVED && complaint.status !== ComplaintStatus.CLOSED) {
      throw badRequest('You can leave feedback once the complaint has been resolved')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { feedbackRating: rating, feedbackComment: comment ?? null },
        include: includeRelations,
      })
      await audit.record(tx, {
        action: 'complaint.feedback',
        entityType: 'complaint',
        entityId: id,
        payload: { rating, hasComment: Boolean(comment) },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(publicComplaint(updated))
  }),
)

/**
 * Supervisor closure.
 *
 * Kept separate from the official's status updates: closing is a sign-off, and
 * only an admin may do it.
 */
complaintsRouter.post(
  '/:id/close',
  requireRole(UserRole.ADMIN),
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(z.object({ note: z.string().max(1000).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!
    const { note } = req.body as { note?: string }

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')
    if (!canTransition(complaint.status, ComplaintStatus.CLOSED)) {
      throw badRequest(
        `A complaint that is ${complaint.status.toLowerCase()} cannot be closed — it must be resolved first`,
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { status: ComplaintStatus.CLOSED, closedAt: new Date() },
        include: includeRelations,
      })
      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus: ComplaintStatus.CLOSED,
          actorId: actor.id,
          note: note ?? 'Closed by supervisor.',
        },
      })
      await tx.notification.create({
        data: {
          userId: complaint.citizenId,
          title: 'Complaint closed',
          body: `Your complaint ${complaint.referenceNo} has been closed. We would appreciate your feedback.`,
          link: `/complaints/${id}`,
        },
      })
      await audit.record(tx, {
        action: 'complaint.closed',
        entityType: 'complaint',
        entityId: id,
        payload: { note: note ?? null },
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
