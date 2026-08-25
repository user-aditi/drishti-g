/**
 * Complaint filing and tracking.
 *
 * Filing is where GCCE runs: the citizen supplies what they saw, and everything
 * else — category, sector, department, the accountable officer, priority and
 * deadline — is decided by the engine and recorded with its reasoning.
 */
import { Router } from 'express'
import { ComplaintStatus, DepartmentStatus, Prisma, Rank } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireCircleOfficer } from '../middleware/auth.js'
import { uploadPhoto, photoUrl } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { OPEN_STATUSES, canTransition, routeComplaint } from '../services/gcce.js'
import { scheduleComplaintSync } from '../services/graphSync.js'
import {
  hasJurisdiction,
  isAuthorityWide,
  isOfficer,
  sectorsInScope,
  departmentsInScope,
} from '../services/hierarchy.js'
import { scheduleSectorRescore } from '../services/riskSignals.js'
import { asyncHandler, badRequest, forbidden, notFound, unprocessable } from '../utils/http.js'
import { COMPLAINT_INCLUDE, publicComplaint, referenceNoFor } from '../utils/serialize.js'

export const complaintsRouter: Router = Router()

complaintsRouter.use(authenticate)

const createSchema = z.object({
  title: z.string().min(5, 'Give your complaint a short title').max(200),
  description: z.string().min(10, 'Describe the issue in a little more detail').max(4000),
  categoryId: z.coerce.number().int().positive().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
  landmark: z.string().max(200).optional(),
})

const listSchema = z.object({
  status: z.nativeEnum(ComplaintStatus).optional(),
  sectorId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  scope: z.enum(['mine', 'jurisdiction', 'all']).default('jurisdiction'),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
})

/**
 * Build the visibility filter for the caller.
 *
 * Scoping happens here rather than in the UI: a Junior Engineer must not be
 * able to read another circle's complaints by editing a query string, and a
 * citizen must only ever see their own.
 */
async function visibilityFilter(
  user: NonNullable<Express.Request['user']>,
  scope: 'mine' | 'jurisdiction' | 'all',
): Promise<Prisma.ComplaintWhereInput> {
  if (user.rank === Rank.CITIZEN) return { citizenId: user.id }

  if (user.rank === Rank.FIELD_WORKER) return { assignedWorkerId: user.id }

  if (scope === 'mine') return { assignedOfficerId: user.id }

  if (isAuthorityWide(user.rank)) return {}

  const [sectors, departments] = await Promise.all([
    sectorsInScope(prisma, user.id),
    departmentsInScope(prisma, user.id),
  ])

  const where: Prisma.ComplaintWhereInput = {}
  if (sectors !== null) where.sectorId = { in: sectors }
  if (departments !== null) where.departmentId = { in: departments }
  return where
}

/**
 * File a complaint.
 *
 * The row is created first so its id can seed the reference number, then GCCE
 * routes it. Both happen in one transaction — a complaint that exists but was
 * never routed would sit invisible to every inbox.
 */
complaintsRouter.post(
  '/',
  uploadPhoto,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>
    const actor = req.user!

    // A citizen chosing a category by hand must not be able to file into a
    // department that is not live yet.
    if (body.categoryId != null) {
      const category = await prisma.complaintCategory.findUnique({
        where: { id: body.categoryId },
        include: { department: true },
      })
      if (!category) throw unprocessable('That category does not exist')
      if (category.department.status !== DepartmentStatus.ACTIVE) {
        throw unprocessable(
          `${category.department.name} is not accepting complaints yet. ${category.department.roadmapNote ?? ''}`.trim(),
        )
      }
    }

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
          landmark: body.landmark ?? null,
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
        include: COMPLAINT_INCLUDE,
      })
      return { complaint: full, decision }
    })

    // Fired after the transaction commits so neither can roll it back.
    scheduleComplaintSync(result.complaint.id)
    if (result.decision.sectorId != null) scheduleSectorRescore(result.decision.sectorId)

    res.status(201).json({
      complaint: publicComplaint(result.complaint),
      routing: result.decision,
    })
  }),
)

complaintsRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { status, sectorId, departmentId, scope, q, page, size } =
      req.query as unknown as z.infer<typeof listSchema>
    const actor = req.user!

    const where = await visibilityFilter(actor, scope)
    if (status) where.status = status
    if (sectorId) where.sectorId = sectorId
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
        include: COMPLAINT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.complaint.count({ where }),
    ])

    res.json({ items: items.map(publicComplaint), total, page, size })
  }),
)

/** Counts for the caller's own scope — drives the dashboard tiles. */
complaintsRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const where = await visibilityFilter(actor, 'jurisdiction')

    const grouped = await prisma.complaint.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })

    const byStatus = Object.fromEntries(
      Object.values(ComplaintStatus).map((s) => [s, 0]),
    ) as Record<ComplaintStatus, number>
    for (const row of grouped) byStatus[row.status] = row._count._all

    const [overdue, escalated] = await Promise.all([
      prisma.complaint.count({
        where: { ...where, slaDueAt: { lt: new Date() }, status: { in: OPEN_STATUSES } },
      }),
      prisma.complaint.count({ where: { ...where, escalationLevel: { gt: 0 } } }),
    ])

    const open = OPEN_STATUSES.reduce((sum, s) => sum + byStatus[s], 0)

    res.json({
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      open,
      resolved: byStatus.RESOLVED + byStatus.CLOSED,
      overdue,
      escalated,
    })
  }),
)

/** Map pins for the caller's jurisdiction. */
complaintsRouter.get(
  '/map',
  validate(
    z.object({
      status: z.enum(['open', 'all']).default('open'),
      departmentId: z.coerce.number().int().positive().optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { status, departmentId } = req.query as unknown as {
      status: 'open' | 'all'
      departmentId?: number
    }
    const actor = req.user!

    const where = await visibilityFilter(actor, 'jurisdiction')
    if (status === 'open') where.status = { in: OPEN_STATUSES }
    if (departmentId) where.departmentId = departmentId
    where.latitude = { not: null }
    where.longitude = { not: null }

    const items = await prisma.complaint.findMany({
      where,
      select: {
        id: true,
        referenceNo: true,
        title: true,
        latitude: true,
        longitude: true,
        status: true,
        priority: true,
        slaDueAt: true,
        escalationLevel: true,
        category: { select: { name: true, icon: true } },
        sector: { select: { id: true, number: true, name: true } },
        department: { select: { id: true, name: true, icon: true } },
      },
      take: 1000,
      orderBy: { createdAt: 'desc' },
    })

    res.json({ items, total: items.length })
  }),
)

async function loadVisibleComplaint(id: number, actor: NonNullable<Express.Request['user']>) {
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      ...COMPLAINT_INCLUDE,
      history: {
        include: { actor: { select: { id: true, fullName: true, rank: true } } },
        orderBy: { createdAt: 'asc' },
      },
      escalations: {
        include: { toUser: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!complaint) throw notFound('That complaint does not exist')

  const isOwner = complaint.citizenId === actor.id
  const isAssigned =
    complaint.assignedOfficerId === actor.id || complaint.assignedWorkerId === actor.id

  if (!isOwner && !isAssigned) {
    if (!isOfficer(actor.rank)) throw forbidden('You do not have access to this complaint')
    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')
  }

  return complaint
}

complaintsRouter.get(
  '/:id',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const complaint = await loadVisibleComplaint(Number(req.params.id), req.user!)
    res.json({
      ...publicComplaint(complaint),
      history: complaint.history.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        evidenceUrl: h.evidenceUrl,
        createdAt: h.createdAt,
        actor: h.actor ? { id: h.actor.id, fullName: h.actor.fullName, rank: h.actor.rank } : null,
      })),
      escalations: complaint.escalations.map((e) => ({
        id: e.id,
        fromRank: e.fromRank,
        toRank: e.toRank,
        reason: e.reason,
        hoursOverdue: e.hoursOverdue,
        createdAt: e.createdAt,
        toUser: e.toUser,
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
        include: COMPLAINT_INCLUDE,
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
 * Sign-off. Restricted to Circle Officer and above — a Junior Engineer must not
 * close their own section's work, which is the separation the manual process
 * relies on.
 */
complaintsRouter.post(
  '/:id/close',
  requireCircleOfficer,
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(z.object({ note: z.string().max(1000).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!
    const { note } = req.body as { note?: string }

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')

    if (!canTransition(complaint.status, ComplaintStatus.CLOSED)) {
      throw badRequest(
        `A complaint that is ${complaint.status.toLowerCase().replace(/_/g, ' ')} cannot be closed — it must be resolved first`,
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { status: ComplaintStatus.CLOSED, closedAt: new Date() },
        include: COMPLAINT_INCLUDE,
      })
      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus: ComplaintStatus.CLOSED,
          actorId: actor.id,
          note: note ?? `Closed by ${actor.designationTitle ?? 'supervising officer'}.`,
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
    if (updated.sectorId != null) scheduleSectorRescore(updated.sectorId)

    res.json(publicComplaint(updated))
  }),
)
