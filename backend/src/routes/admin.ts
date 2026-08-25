/**
 * Oversight surfaces for senior officers.
 *
 * Everything here is scoped to the caller's jurisdiction, so an Executive
 * Engineer sees their circle, a General Manager sees their department, and the
 * CEO and Super Admin see the whole authority — from one set of endpoints.
 */
import { Router } from 'express'
import { ComplaintStatus, Prisma, Rank } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireOfficer, requireSuperAdmin } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { runEscalationSweep } from '../services/escalation.js'
import { OPEN_STATUSES } from '../services/gcce.js'
import {
  RANK_LABEL,
  departmentsInScope,
  isAuthorityWide,
  sectorsInScope,
} from '../services/hierarchy.js'
import { asyncHandler, badRequest, notFound } from '../utils/http.js'
import { publicUser } from '../utils/serialize.js'

export const adminRouter: Router = Router()

adminRouter.use(authenticate, requireOfficer)

/** The complaint filter matching the caller's jurisdiction. */
async function scopeFilter(
  user: NonNullable<Express.Request['user']>,
): Promise<Prisma.ComplaintWhereInput> {
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

/** Everything the oversight dashboard shows above the fold, in one round trip. */
adminRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const scope = await scopeFilter(actor)
    const now = new Date()

    const [byStatus, total, overdue, escalated, pendingFlags, byDepartment, resolvedSample] =
      await Promise.all([
        prisma.complaint.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        prisma.complaint.count({ where: scope }),
        prisma.complaint.count({
          where: { ...scope, status: { in: OPEN_STATUSES }, slaDueAt: { lt: now } },
        }),
        prisma.complaint.count({ where: { ...scope, escalationLevel: { gt: 0 } } }),
        prisma.riskFlag.count({ where: { status: 'PENDING' } }),
        prisma.complaint.groupBy({
          by: ['departmentId'],
          where: { ...scope, departmentId: { not: null } },
          _count: { _all: true },
        }),
        prisma.complaint.findMany({
          where: { ...scope, resolvedAt: { not: null } },
          select: { createdAt: true, resolvedAt: true },
          take: 500,
          orderBy: { resolvedAt: 'desc' },
        }),
      ])

    const statusCounts = Object.fromEntries(
      Object.values(ComplaintStatus).map((s) => [s, 0]),
    ) as Record<ComplaintStatus, number>
    for (const row of byStatus) statusCounts[row.status] = row._count._all

    const departments = await prisma.department.findMany()
    const departmentBreakdown = byDepartment
      .map((row) => ({
        departmentId: row.departmentId!,
        name: departments.find((d) => d.id === row.departmentId)?.name ?? 'Unknown',
        icon: departments.find((d) => d.id === row.departmentId)?.icon ?? '🏛️',
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count)

    // Averaged over the most recent 500 resolutions rather than all of history,
    // so the number tracks current performance.
    const avgResolutionDays =
      resolvedSample.length > 0
        ? resolvedSample.reduce(
            (sum, c) => sum + (c.resolvedAt!.getTime() - c.createdAt.getTime()),
            0,
          ) /
          resolvedSample.length /
          86_400_000
        : null

    const [citizens, officers, workers] = await Promise.all([
      prisma.user.count({ where: { rank: Rank.CITIZEN } }),
      prisma.user.count({
        where: { rank: { in: [Rank.SECTION_OFFICER, Rank.CIRCLE_OFFICER, Rank.ZONAL_OFFICER, Rank.HOD] }, isActive: true },
      }),
      prisma.user.count({ where: { rank: Rank.FIELD_WORKER, isActive: true } }),
    ])

    const open = OPEN_STATUSES.reduce((sum, s) => sum + statusCounts[s], 0)

    res.json({
      viewer: {
        rank: actor.rank,
        rankLabel: RANK_LABEL[actor.rank],
        designationTitle: actor.designationTitle,
        scopeLabel: isAuthorityWide(actor.rank) ? 'Whole authority' : 'Your jurisdiction',
      },
      complaints: {
        total,
        open,
        overdue,
        escalated,
        resolved: statusCounts.RESOLVED + statusCounts.CLOSED,
        awaitingVerification: statusCounts.AWAITING_VERIFICATION,
        byStatus: statusCounts,
      },
      pendingFlags,
      people: { citizens, officers, workers },
      departmentBreakdown,
      avgResolutionDays: avgResolutionDays === null ? null : Number(avgResolutionDays.toFixed(1)),
    })
  }),
)

/** Performance per sector, for the caller's jurisdiction. */
adminRouter.get(
  '/sector-performance',
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const scope = await scopeFilter(actor)

    const sectorIds =
      scope.sectorId && typeof scope.sectorId === 'object' && 'in' in scope.sectorId
        ? (scope.sectorId.in as number[])
        : undefined

    const sectors = await prisma.sector.findMany({
      where: sectorIds ? { id: { in: sectorIds } } : {},
      include: { circle: { include: { zone: true } } },
      orderBy: { number: 'asc' },
    })

    const now = new Date()
    const rows = await Promise.all(
      sectors.map(async (sector) => {
        const base: Prisma.ComplaintWhereInput = { ...scope, sectorId: sector.id }
        const [total, open, overdue, escalated] = await Promise.all([
          prisma.complaint.count({ where: base }),
          prisma.complaint.count({ where: { ...base, status: { in: OPEN_STATUSES } } }),
          prisma.complaint.count({
            where: { ...base, status: { in: OPEN_STATUSES }, slaDueAt: { lt: now } },
          }),
          prisma.complaint.count({ where: { ...base, escalationLevel: { gt: 0 } } }),
        ])
        return {
          sectorId: sector.id,
          number: sector.number,
          name: sector.name,
          circle: sector.circle.name,
          zone: sector.circle.zone.name,
          total,
          open,
          overdue,
          escalated,
        }
      }),
    )

    res.json({ items: rows.sort((a, b) => b.overdue - a.overdue || b.open - a.open) })
  }),
)

/** Complaints escalated to the caller — the queue that says "this is now yours". */
adminRouter.get(
  '/escalations',
  asyncHandler(async (req, res) => {
    const escalations = await prisma.escalation.findMany({
      where: { toUserId: req.user!.id },
      include: {
        complaint: {
          include: {
            category: true,
            department: true,
            sector: true,
            assignedOfficer: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    res.json({
      items: escalations.map((e) => ({
        id: e.id,
        reason: e.reason,
        hoursOverdue: e.hoursOverdue,
        fromRank: e.fromRank,
        fromRankLabel: RANK_LABEL[e.fromRank],
        toRank: e.toRank,
        acknowledgedAt: e.acknowledgedAt,
        createdAt: e.createdAt,
        complaint: {
          id: e.complaint.id,
          referenceNo: e.complaint.referenceNo,
          title: e.complaint.title,
          status: e.complaint.status,
          priority: e.complaint.priority,
          slaDueAt: e.complaint.slaDueAt,
          category: e.complaint.category
            ? { name: e.complaint.category.name, icon: e.complaint.category.icon }
            : null,
          department: e.complaint.department ? { name: e.complaint.department.name } : null,
          sector: e.complaint.sector
            ? { number: e.complaint.sector.number, name: e.complaint.sector.name }
            : null,
        },
      })),
      total: escalations.length,
    })
  }),
)

adminRouter.post(
  '/escalations/:id/acknowledge',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!

    const escalation = await prisma.escalation.findUnique({ where: { id } })
    if (!escalation) throw notFound('That escalation does not exist')
    if (escalation.toUserId !== actor.id) {
      throw badRequest('This escalation was not raised to you')
    }

    const updated = await prisma.escalation.update({
      where: { id },
      data: { acknowledgedAt: new Date() },
    })

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'escalation.acknowledged',
        entityType: 'complaint',
        entityId: escalation.complaintId,
        payload: { escalationId: id },
        actorId: actor.id,
        actorLabel: actor.fullName,
      }),
    )

    res.json(updated)
  }),
)

/** Run the escalation sweep on demand. Scheduled in production. */
adminRouter.post(
  '/escalations/sweep',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await runEscalationSweep())
  }),
)

// --- People ------------------------------------------------------------------

adminRouter.get(
  '/users',
  validate(
    z.object({
      rank: z.nativeEnum(Rank).optional(),
      departmentId: z.coerce.number().int().positive().optional(),
      sectorId: z.coerce.number().int().positive().optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      size: z.coerce.number().int().min(1).max(100).default(25),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { rank, departmentId, sectorId, q, page, size } = req.query as unknown as {
      rank?: Rank
      departmentId?: number
      sectorId?: number
      q?: string
      page: number
      size: number
    }

    const where: Prisma.UserWhereInput = {}
    if (rank) where.rank = rank
    if (departmentId || sectorId) {
      where.postings = {
        some: {
          endedAt: null,
          ...(departmentId ? { departmentId } : {}),
          ...(sectorId ? { sectorId } : {}),
        },
      }
    }
    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          homeSector: true,
          postings: {
            where: { endedAt: null },
            include: { department: true, zone: true, circle: true, sector: true },
          },
        },
        orderBy: [{ rank: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.user.count({ where }),
    ])

    res.json({ items: items.map(publicUser), total, page, size })
  }),
)

adminRouter.patch(
  '/users/:id',
  requireSuperAdmin,
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      fullName: z.string().min(2).max(128).optional(),
      phone: z.string().max(20).nullable().optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const changes = req.body as Record<string, unknown>
    const actor = req.user!

    if (id === actor.id && changes.isActive === false) {
      throw badRequest('You cannot deactivate your own account')
    }

    const user = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id },
        data: changes,
        include: {
          homeSector: true,
          postings: {
            where: { endedAt: null },
            include: { department: true, zone: true, circle: true, sector: true },
          },
        },
      })
      await audit.record(tx, {
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        payload: { changes },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(publicUser(user))
  }),
)

// --- Audit trail -------------------------------------------------------------

adminRouter.get(
  '/audit',
  validate(
    z.object({
      entityType: z.string().max(48).optional(),
      entityId: z.string().max(64).optional(),
      action: z.string().max(64).optional(),
      page: z.coerce.number().int().min(1).default(1),
      size: z.coerce.number().int().min(1).max(100).default(50),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { entityType, entityId, action, page, size } = req.query as unknown as {
      entityType?: string
      entityId?: string
      action?: string
      page: number
      size: number
    }

    const where: Prisma.AuditEventWhereInput = {}
    if (entityType) where.entityType = entityType
    if (entityId) where.entityId = entityId
    if (action) where.action = { contains: action }

    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.auditEvent.count({ where }),
    ])

    res.json({ items, total, page, size })
  }),
)

adminRouter.get(
  '/audit/verify',
  asyncHandler(async (_req, res) => {
    res.json(await audit.verifyChain(prisma))
  }),
)
