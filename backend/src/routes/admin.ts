/** Admin surfaces: user management, city-wide statistics, and the audit trail. */
import { Router } from 'express'
import { ComplaintStatus, Prisma, UserRole } from '@prisma/client'
import { z } from 'zod'
import { hashPassword } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { asyncHandler, badRequest, conflict, unprocessable } from '../utils/http.js'
import { publicUser } from '../utils/serialize.js'

export const adminRouter: Router = Router()

adminRouter.use(authenticate, requireAdmin)

// --- Users -------------------------------------------------------------------

adminRouter.get(
  '/users',
  validate(
    z.object({
      role: z.nativeEnum(UserRole).optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      size: z.coerce.number().int().min(1).max(100).default(25),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { role, q, page, size } = req.query as unknown as {
      role?: UserRole
      q?: string
      page: number
      size: number
    }

    const where: Prisma.UserWhereInput = {}
    if (role) where.role = role
    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { ward: true, department: true },
        orderBy: { id: 'asc' },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.user.count({ where }),
    ])

    res.json({ items: items.map(publicUser), total, page, size })
  }),
)

const createUserSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2).max(128),
  phone: z.string().max(20).optional(),
  role: z.nativeEnum(UserRole),
  wardId: z.number().int().positive().nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
})

/** The only path to an official or admin account — registration is citizens only. */
adminRouter.post(
  '/users',
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createUserSchema>
    const actor = req.user!

    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw conflict('An account with this email already exists')
    }

    // GCCE assigns work by department + ward. An official missing either would
    // never receive a task, so refuse rather than create a dead account.
    if (body.role === UserRole.FIELD_OFFICIAL && (!body.wardId || !body.departmentId)) {
      throw unprocessable('A field official needs both a ward and a department')
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email,
          hashedPassword: await hashPassword(body.password),
          fullName: body.fullName,
          phone: body.phone ?? null,
          role: body.role,
          wardId: body.wardId ?? null,
          departmentId: body.departmentId ?? null,
        },
        include: { ward: true, department: true },
      })
      await audit.record(tx, {
        action: 'user.created',
        entityType: 'user',
        entityId: created.id,
        payload: { email: created.email, role: created.role },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return created
    })

    res.status(201).json(publicUser(user))
  }),
)

adminRouter.patch(
  '/users/:id',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      fullName: z.string().min(2).max(128).optional(),
      phone: z.string().max(20).nullable().optional(),
      wardId: z.number().int().positive().nullable().optional(),
      departmentId: z.number().int().positive().nullable().optional(),
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
        include: { ward: true, department: true },
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

// --- City-wide statistics ----------------------------------------------------

/** Everything the admin dashboard shows above the fold, in one round trip. */
adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const now = new Date()
    const OPEN: ComplaintStatus[] = [
      ComplaintStatus.SUBMITTED,
      ComplaintStatus.ROUTED,
      ComplaintStatus.ASSIGNED,
      ComplaintStatus.IN_PROGRESS,
    ]

    const [byStatus, total, open, overdue, pendingFlags, citizens, officials, byDepartment, resolvedSample] =
      await Promise.all([
        prisma.complaint.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.complaint.count(),
        prisma.complaint.count({ where: { status: { in: OPEN } } }),
        prisma.complaint.count({ where: { status: { in: OPEN }, slaDueAt: { lt: now } } }),
        prisma.riskFlag.count({ where: { status: 'PENDING' } }),
        prisma.user.count({ where: { role: UserRole.CITIZEN } }),
        prisma.user.count({ where: { role: UserRole.FIELD_OFFICIAL, isActive: true } }),
        prisma.complaint.groupBy({
          by: ['departmentId'],
          _count: { _all: true },
          where: { departmentId: { not: null } },
        }),
        prisma.complaint.findMany({
          where: { resolvedAt: { not: null } },
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
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count)

    // Averaged over the most recent 500 resolutions rather than all of history,
    // so the number tracks current performance instead of being anchored by the
    // system's first week.
    const avgResolutionDays =
      resolvedSample.length > 0
        ? resolvedSample.reduce(
            (sum, c) => sum + (c.resolvedAt!.getTime() - c.createdAt.getTime()),
            0,
          ) /
          resolvedSample.length /
          86_400_000
        : null

    res.json({
      complaints: {
        total,
        open,
        overdue,
        resolved: statusCounts.RESOLVED + statusCounts.CLOSED,
        byStatus: statusCounts,
      },
      pendingFlags,
      people: { citizens, officials },
      departmentBreakdown,
      avgResolutionDays: avgResolutionDays === null ? null : Number(avgResolutionDays.toFixed(1)),
    })
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

/** Recompute the whole chain and report the first break, if any. */
adminRouter.get(
  '/audit/verify',
  asyncHandler(async (_req, res) => {
    res.json(await audit.verifyChain(prisma))
  }),
)
