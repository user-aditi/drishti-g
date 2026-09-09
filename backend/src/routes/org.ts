/**
 * The organisation: geography, departments, categories, and the staff postings
 * that connect people to both.
 *
 * Reads are open to any signed-in user — a citizen filing a complaint needs the
 * category list. Everything that changes the shape of the authority is
 * restricted to the Super Admin, who is the only role with sight of every
 * department at once.
 */
import { Router } from 'express'
import { DepartmentStatus, JurisdictionLevel, Rank, Trade } from '@prisma/client'
import { z } from 'zod'
import { hashPassword } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireSuperAdmin } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { RANK_JURISDICTION, RANK_LABEL, RANK_LEVEL, designationFor } from '../services/hierarchy.js'
import * as org from '../services/orgTree.js'
import { asyncHandler, conflict, notFound, unprocessable } from '../utils/http.js'
import { publicPosting, publicUser } from '../utils/serialize.js'

export const orgRouter: Router = Router()

orgRouter.use(authenticate)

// --- Reference data ----------------------------------------------------------

/** The whole geographic tree in one call — small enough not to paginate. */
orgRouter.get(
  '/geography',
  asyncHandler(async (_req, res) => {
    const zones = await prisma.zone.findMany({
      include: {
        circles: {
          include: { sectors: { orderBy: { number: 'asc' } } },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: { code: 'asc' },
    })
    res.json(zones)
  }),
)

orgRouter.get(
  '/sectors',
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.sector.findMany({
        include: { circle: { include: { zone: true } } },
        orderBy: { number: 'asc' },
      }),
    )
  }),
)

orgRouter.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    const departments = await prisma.department.findMany({
      include: {
        designations: true,
        _count: { select: { categories: true, postings: true, complaints: true } },
      },
      orderBy: { sortOrder: 'asc' },
    })
    res.json(departments)
  }),
)

orgRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    // Coming-soon departments are filtered out: offering a category that cannot
    // be actioned would be worse than not listing it.
    res.json(
      await prisma.complaintCategory.findMany({
        where: { isActive: true, department: { status: DepartmentStatus.ACTIVE } },
        include: { department: { select: { id: true, name: true, code: true, icon: true } } },
        orderBy: [{ departmentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
    )
  }),
)

/** The rank ladder, so the UI does not hard-code the org chart. */
orgRouter.get('/ranks', (_req, res) => {
  res.json(
    Object.values(Rank).map((rank) => ({
      rank,
      level: RANK_LEVEL[rank],
      label: RANK_LABEL[rank],
      jurisdiction: RANK_JURISDICTION[rank],
    })),
  )
})

orgRouter.get('/trades', (_req, res) => {
  res.json(
    Object.values(Trade).map((trade) => ({
      trade,
      label: trade
        .split('_')
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' '),
    })),
  )
})

// --- Org chart ---------------------------------------------------------------

/**
 * Who holds which post, for one department.
 *
 * This is the screen that answers "who is responsible for Sector 5 sanitation?"
 * without anyone having to ask around.
 */
orgRouter.get(
  '/departments/:id/chart',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const departmentId = Number(req.params.id)

    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      include: { designations: true },
    })
    if (!department) throw notFound('That department does not exist')

    const postings = await prisma.posting.findMany({
      where: { departmentId, endedAt: null },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true } },
        zone: true,
        circle: { include: { zone: true } },
        sector: { include: { circle: true } },
      },
      orderBy: [{ rank: 'desc' }, { id: 'asc' }],
    })

    // Grouped by rank so the client renders tiers rather than re-deriving them.
    const byRank = new Map<Rank, typeof postings>()
    for (const p of postings) {
      const list = byRank.get(p.rank) ?? []
      list.push(p)
      byRank.set(p.rank, list)
    }

    const tiers = [...byRank.entries()]
      .sort(([a], [b]) => RANK_LEVEL[b] - RANK_LEVEL[a])
      .map(([rank, list]) => ({
        rank,
        label: RANK_LABEL[rank],
        designation: department.designations.find((d) => d.rank === rank)?.title ?? RANK_LABEL[rank],
        count: list.length,
        people: list.map((p) => ({
          ...publicPosting(p),
          user: p.user,
          /** Where they sit, in one readable line. */
          jurisdictionLabel:
            p.sector != null
              ? `Sector ${p.sector.number}`
              : p.circle != null
                ? p.circle.name
                : p.zone != null
                  ? p.zone.name
                  : 'Authority-wide',
        })),
      }))

    res.json({
      department: {
        id: department.id,
        code: department.code,
        name: department.name,
        nameHi: department.nameHi,
        icon: department.icon,
        status: department.status,
      },
      tiers,
      totalStaff: postings.length,
    })
  }),
)

/** Who covers a given sector, across every active department. */
orgRouter.get(
  '/sectors/:id/staff',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const sectorId = Number(req.params.id)
    const sector = await prisma.sector.findUnique({
      where: { id: sectorId },
      include: { circle: { include: { zone: true } } },
    })
    if (!sector) throw notFound('That sector does not exist')

    const postings = await prisma.posting.findMany({
      where: {
        endedAt: null,
        OR: [
          { sectorId },
          { circleId: sector.circleId },
          { zoneId: sector.circle.zoneId },
          { level: JurisdictionLevel.AUTHORITY },
        ],
      },
      include: {
        user: { select: { id: true, fullName: true, isActive: true } },
        department: { select: { id: true, name: true, code: true, icon: true } },
      },
      orderBy: [{ rank: 'asc' }],
    })

    res.json({
      sector: {
        id: sector.id,
        number: sector.number,
        name: sector.name,
        circle: { id: sector.circle.id, name: sector.circle.name },
        zone: { id: sector.circle.zone.id, name: sector.circle.zone.name },
      },
      staff: postings.map((p) => ({ ...publicPosting(p), user: p.user })),
    })
  }),
)

// --- Super Admin: shaping the authority --------------------------------------

const departmentSchema = z.object({
  code: z.string().min(2).max(16).transform((c) => c.toUpperCase()),
  name: z.string().min(2).max(128),
  nameHi: z.string().max(128).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(8).optional(),
  status: z.nativeEnum(DepartmentStatus).default(DepartmentStatus.COMING_SOON),
  roadmapNote: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
})

orgRouter.post(
  '/departments',
  requireSuperAdmin,
  validate(departmentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof departmentSchema>
    const actor = req.user!

    const department = await prisma.$transaction(async (tx) => {
      const created = await tx.department.create({ data: body })
      await audit.record(tx, {
        action: 'department.created',
        entityType: 'department',
        entityId: created.id,
        payload: { ...body },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return created
    })

    res.status(201).json(department)
  }),
)

/** Flip a department live, or back onto the roadmap. */
orgRouter.patch(
  '/departments/:id',
  requireSuperAdmin,
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      status: z.nativeEnum(DepartmentStatus).optional(),
      name: z.string().min(2).max(128).optional(),
      description: z.string().max(500).optional(),
      roadmapNote: z.string().max(500).nullable().optional(),
      icon: z.string().max(8).optional(),
      sortOrder: z.number().int().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const changes = req.body as Record<string, unknown>
    const actor = req.user!

    if (changes.status === DepartmentStatus.ACTIVE) {
      // Going live without staff would mean complaints routed to nobody.
      const staffed = await prisma.posting.count({
        where: { departmentId: id, rank: Rank.SECTION_OFFICER, endedAt: null },
      })
      if (staffed === 0) {
        throw unprocessable(
          'Post at least one Section Officer before making this department live, or complaints will route to nobody',
        )
      }
    }

    const department = await prisma.$transaction(async (tx) => {
      const saved = await tx.department.update({ where: { id }, data: changes })
      await audit.record(tx, {
        action: 'department.updated',
        entityType: 'department',
        entityId: id,
        payload: { changes },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(department)
  }),
)

const staffSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2).max(128),
  phone: z.string().max(20).optional(),
  rank: z.nativeEnum(Rank),
  departmentId: z.number().int().positive().nullable().optional(),
  zoneId: z.number().int().positive().nullable().optional(),
  circleId: z.number().int().positive().nullable().optional(),
  sectorId: z.number().int().positive().nullable().optional(),
  trade: z.nativeEnum(Trade).nullable().optional(),
  employeeCode: z.string().max(32).optional(),
})

/**
 * Create a staff account and its posting together.
 *
 * The two are inseparable in practice — a person without a posting is not on
 * the org chart, and would receive no work.
 */
orgRouter.post(
  '/staff',
  requireSuperAdmin,
  validate(staffSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof staffSchema>
    const actor = req.user!

    if (body.rank === Rank.CITIZEN) {
      throw unprocessable('Citizens register themselves — this endpoint is for staff')
    }
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw conflict('An account with this email already exists')
    }

    const level = RANK_JURISDICTION[body.rank]

    // The posting must carry the jurisdiction its rank operates over, or the
    // person exists on the chart but is invisible to routing.
    if (level === JurisdictionLevel.SECTOR && !body.sectorId) {
      throw unprocessable(`A ${RANK_LABEL[body.rank]} must be posted to a sector`)
    }
    if (level === JurisdictionLevel.CIRCLE && !body.circleId) {
      throw unprocessable(`A ${RANK_LABEL[body.rank]} must be posted to a work circle`)
    }
    if (level === JurisdictionLevel.ZONE && !body.zoneId) {
      throw unprocessable(`A ${RANK_LABEL[body.rank]} must be posted to a zone`)
    }
    if (body.rank !== Rank.SUPER_ADMIN && body.rank !== Rank.CEO && !body.departmentId) {
      throw unprocessable(`A ${RANK_LABEL[body.rank]} must belong to a department`)
    }
    if (body.rank === Rank.FIELD_WORKER && !body.trade) {
      throw unprocessable('A field worker needs a trade, so the right jobs reach them')
    }

    const designationTitle = await designationFor(prisma, body.departmentId ?? null, body.rank)
    const orgUnitId = await org.resolveUnitForPosting(prisma, body)
    if (orgUnitId == null) {
      throw unprocessable('That posting does not correspond to any unit of the authority')
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email,
          hashedPassword: await hashPassword(body.password),
          fullName: body.fullName,
          phone: body.phone ?? null,
          rank: body.rank,
        },
      })

      await tx.posting.create({
        data: {
          userId: created.id,
          departmentId: body.departmentId ?? null,
          rank: body.rank,
          level,
          // Without this the appointment is invisible to routing and scope.
          orgUnitId,
          zoneId: level === JurisdictionLevel.ZONE ? body.zoneId : null,
          circleId: level === JurisdictionLevel.CIRCLE ? body.circleId : null,
          sectorId: level === JurisdictionLevel.SECTOR ? body.sectorId : null,
          trade: body.trade ?? null,
          designationTitle,
          employeeCode: body.employeeCode ?? null,
        },
      })

      await audit.record(tx, {
        action: 'staff.appointed',
        entityType: 'user',
        entityId: created.id,
        payload: {
          email: created.email,
          rank: body.rank,
          departmentId: body.departmentId ?? null,
          designationTitle,
        },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          homeSector: true,
          postings: { include: { department: true, zone: true, circle: true, sector: true } },
        },
      })
    })

    res.status(201).json(publicUser(user))
  }),
)

/**
 * Transfer someone to a new post.
 *
 * The old posting is ended rather than edited, so the record of who held which
 * charge and when survives — which is exactly what an audit would ask for.
 */
orgRouter.post(
  '/staff/:id/transfer',
  requireSuperAdmin,
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      rank: z.nativeEnum(Rank),
      departmentId: z.number().int().positive().nullable().optional(),
      zoneId: z.number().int().positive().nullable().optional(),
      circleId: z.number().int().positive().nullable().optional(),
      sectorId: z.number().int().positive().nullable().optional(),
      trade: z.nativeEnum(Trade).nullable().optional(),
      reason: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id)
    const body = req.body as z.infer<typeof staffSchema> & { reason?: string }
    const actor = req.user!

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw notFound('That person does not exist')

    const level = RANK_JURISDICTION[body.rank]
    const designationTitle = await designationFor(prisma, body.departmentId ?? null, body.rank)
    const orgUnitId = await org.resolveUnitForPosting(prisma, body)
    if (orgUnitId == null) {
      throw unprocessable('That posting does not correspond to any unit of the authority')
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.posting.updateMany({
        where: { userId, endedAt: null },
        data: { endedAt: new Date(), isPrimary: false },
      })

      await tx.posting.create({
        data: {
          userId,
          departmentId: body.departmentId ?? null,
          rank: body.rank,
          level,
          // Without this the transfer is invisible to routing and scope.
          orgUnitId,
          zoneId: level === JurisdictionLevel.ZONE ? body.zoneId : null,
          circleId: level === JurisdictionLevel.CIRCLE ? body.circleId : null,
          sectorId: level === JurisdictionLevel.SECTOR ? body.sectorId : null,
          trade: body.trade ?? null,
          designationTitle,
        },
      })

      await tx.user.update({ where: { id: userId }, data: { rank: body.rank } })

      await audit.record(tx, {
        action: 'staff.transferred',
        entityType: 'user',
        entityId: userId,
        payload: {
          toRank: body.rank,
          departmentId: body.departmentId ?? null,
          designationTitle,
          reason: body.reason ?? null,
        },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          homeSector: true,
          postings: {
            where: { endedAt: null },
            include: { department: true, zone: true, circle: true, sector: true },
          },
        },
      })
    })

    res.json(publicUser(updated))
  }),
)
