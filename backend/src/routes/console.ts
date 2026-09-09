/**
 * The Super Admin control room.
 *
 * Every other router serves one role doing one job. This one serves the person
 * who *shapes* the authority: they draw the geography, create departments,
 * decide what each rank is called inside them, define what a complaint can be
 * about, appoint the staff, commission the works, and — when something has gone
 * wrong — reach into a single complaint and put it right.
 *
 * Two rules hold throughout:
 *
 *  1. Everything here is `requireSuperAdmin`. Reads included: knowing the full
 *     shape of the authority is itself a privilege, and the scoped views in
 *     admin.ts already serve everyone below.
 *  2. Every write is audited inside the same transaction. The control room is
 *     precisely where an unaccountable change would do the most damage.
 */
import { Router } from 'express'
import {
  ComplaintStatus,
  DecisionKind,
  DecisionOutcome,
  DepartmentStatus,
  JurisdictionLevel,
  Prisma,
  Priority,
  Rank,
  Trade,
} from '@prisma/client'
import { z } from 'zod'
import { hashPassword } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireSuperAdmin } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import * as decisions from '../services/decisions.js'
import * as eventLog from '../services/eventLog.js'
import { OPEN_STATUSES } from '../services/gcce.js'
import {
  RANK_JURISDICTION,
  RANK_LABEL,
  RANK_LEVEL,
  designationFor,
} from '../services/hierarchy.js'
import * as org from '../services/orgTree.js'
import { asyncHandler, badRequest, notFound, unprocessable } from '../utils/http.js'
import { COMPLAINT_INCLUDE, publicComplaint, publicPosting, publicUser } from '../utils/serialize.js'

export const consoleRouter: Router = Router()

consoleRouter.use(authenticate, requireSuperAdmin)

const idParam = z.object({ id: z.coerce.number().int().positive() })

// ---------------------------------------------------------------------------
// Overview — one call behind the control room's front page
// ---------------------------------------------------------------------------

/**
 * A census of the platform: how many rows sit in every table the Super Admin
 * owns, plus the handful of counts that mean "something needs you".
 */
consoleRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const now = new Date()

    const [
      zones,
      circles,
      sectors,
      departments,
      activeDepartments,
      designations,
      categories,
      activeCategories,
      staff,
      inactiveStaff,
      citizens,
      postings,
      complaints,
      openComplaints,
      overdue,
      unrouted,
      pendingFlags,
      auditEvents,
    ] = await Promise.all([
      prisma.zone.count(),
      prisma.circle.count(),
      prisma.sector.count(),
      prisma.department.count(),
      prisma.department.count({ where: { status: DepartmentStatus.ACTIVE } }),
      prisma.designation.count(),
      prisma.complaintCategory.count(),
      prisma.complaintCategory.count({ where: { isActive: true } }),
      prisma.user.count({ where: { rank: { not: Rank.CITIZEN } } }),
      prisma.user.count({ where: { rank: { not: Rank.CITIZEN }, isActive: false } }),
      prisma.user.count({ where: { rank: Rank.CITIZEN } }),
      prisma.posting.count({ where: { endedAt: null } }),
      prisma.complaint.count(),
      prisma.complaint.count({ where: { status: { in: OPEN_STATUSES } } }),
      prisma.complaint.count({
        where: { status: { in: OPEN_STATUSES }, slaDueAt: { lt: now } },
      }),
      // Routed but sitting with nobody: the failure mode a Super Admin must see.
      prisma.complaint.count({
        where: { status: { in: OPEN_STATUSES }, assignedOfficerId: null },
      }),
      prisma.riskFlag.count({ where: { status: 'PENDING' } }),
      prisma.auditEvent.count(),
    ])

    // Departments that are live but have no Section Officer anywhere are a
    // routing black hole — complaints will arrive and stop.
    const liveDepartments = await prisma.department.findMany({
      where: { status: DepartmentStatus.ACTIVE },
      select: { id: true, name: true, icon: true },
    })
    const unstaffed: { id: number; name: string; icon: string }[] = []
    for (const d of liveDepartments) {
      const count = await prisma.posting.count({
        where: { departmentId: d.id, rank: Rank.SECTION_OFFICER, endedAt: null },
      })
      if (count === 0) unstaffed.push(d)
    }

    // Sectors with no Section Officer in any department: a complaint filed here
    // routes to nobody.
    const uncoveredSectors = await prisma.sector.findMany({
      where: { postings: { none: { rank: Rank.SECTION_OFFICER, endedAt: null } } },
      select: { id: true, number: true, name: true },
      orderBy: { number: 'asc' },
    })

    res.json({
      registers: {
        zones,
        circles,
        sectors,
        departments,
        activeDepartments,
        designations,
        categories,
        activeCategories,
        staff,
        inactiveStaff,
        citizens,
        postings,
        complaints,
        auditEvents,
      },
      attention: {
        openComplaints,
        overdue,
        unrouted,
        pendingFlags,
        unstaffedDepartments: unstaffed,
        uncoveredSectors,
      },
    })
  }),
)

// ---------------------------------------------------------------------------
// Geography
//
// The zone / circle / sector editors used to live here — 11 endpoints creating,
// renaming and deleting three fixed tiers. They were replaced by the org tree,
// where a unit is a unit at any depth and adding a layer is `POST /console/units`
// rather than a schema change. See routes/orgUnits.ts.
//
// The read-only `/console/geography` rows went with them: the tree screen shows
// the same counts against the units that actually carry the work.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Designations — naming each rank inside a department
// ---------------------------------------------------------------------------

/** Every designation across every department, as rows. */
consoleRouter.get(
  '/designations',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.designation.findMany({
      include: { department: { select: { id: true, name: true, code: true, icon: true } } },
      orderBy: [{ departmentId: 'asc' }, { rank: 'desc' }],
    })

    // How many people currently hold each post, so renaming an occupied title
    // is a visibly consequential act rather than a text edit.
    const held = await prisma.posting.groupBy({
      by: ['departmentId', 'rank'],
      where: { endedAt: null },
      _count: { _all: true },
    })

    res.json({
      items: rows.map((d) => ({
        id: d.id,
        departmentId: d.departmentId,
        department: d.department,
        rank: d.rank,
        rankLabel: RANK_LABEL[d.rank],
        title: d.title,
        titleHi: d.titleHi,
        shortTitle: d.shortTitle,
        holders:
          held.find((h) => h.departmentId === d.departmentId && h.rank === d.rank)?._count._all ?? 0,
      })),
    })
  }),
)

const designationSchema = z.object({
  departmentId: z.number().int().positive(),
  rank: z.nativeEnum(Rank),
  title: z.string().min(2).max(128),
  titleHi: z.string().max(128).nullable().optional(),
  shortTitle: z.string().max(16).nullable().optional(),
})

/**
 * Name a rank inside a department, creating or replacing in one call.
 *
 * Upsert rather than create+update because there is exactly one title per
 * (department, rank) and the caller is editing a cell in a grid, not managing
 * the lifecycle of a row.
 */
consoleRouter.put(
  '/designations',
  validate(designationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof designationSchema>
    const actor = req.user!

    if (body.rank === Rank.CITIZEN) {
      throw unprocessable('Citizens hold no post inside a department')
    }

    const designation = await prisma.$transaction(async (tx) => {
      const saved = await tx.designation.upsert({
        where: { departmentId_rank: { departmentId: body.departmentId, rank: body.rank } },
        create: body,
        update: { title: body.title, titleHi: body.titleHi, shortTitle: body.shortTitle },
      })

      // Live postings carry a snapshot of the title. Refresh the current ones so
      // the org chart reads correctly; ended postings keep their historical
      // wording on purpose.
      await tx.posting.updateMany({
        where: { departmentId: body.departmentId, rank: body.rank, endedAt: null },
        data: { designationTitle: body.title },
      })

      await audit.record(tx, {
        action: 'designation.set',
        entityType: 'designation',
        entityId: saved.id,
        payload: { ...body },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(designation)
  }),
)

consoleRouter.delete(
  '/designations/:id',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!

    await prisma.$transaction(async (tx) => {
      await tx.designation.delete({ where: { id } })
      await audit.record(tx, {
        action: 'designation.deleted',
        entityType: 'designation',
        entityId: id,
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    res.status(204).end()
  }),
)

// ---------------------------------------------------------------------------
// Complaint categories — deciding what the city can report
// ---------------------------------------------------------------------------

/** Every category including the switched-off ones, which /categories hides. */
consoleRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.complaintCategory.findMany({
      include: {
        department: { select: { id: true, name: true, code: true, icon: true, status: true } },
        _count: { select: { complaints: true } },
      },
      orderBy: [{ departmentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    })

    res.json({
      items: rows.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        nameHi: c.nameHi,
        icon: c.icon,
        departmentId: c.departmentId,
        department: c.department,
        defaultSlaHours: c.defaultSlaHours,
        keywords: c.keywords,
        trade: c.trade,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        complaintCount: c._count.complaints,
      })),
    })
  }),
)

const categorySchema = z.object({
  code: z.string().min(2).max(32).transform((c) => c.toUpperCase().replace(/\s+/g, '_')),
  name: z.string().min(2).max(128),
  nameHi: z.string().max(128).nullable().optional(),
  departmentId: z.number().int().positive(),
  defaultSlaHours: z.number().int().min(1).max(8760).default(72),
  /** Comma-separated, Hinglish welcome — this is what GCCE matches against. */
  keywords: z.string().max(1000).default(''),
  icon: z.string().max(8).default('📋'),
  trade: z.nativeEnum(Trade).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(100),
})

consoleRouter.post(
  '/categories',
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof categorySchema>
    const actor = req.user!

    if (!(await prisma.department.findUnique({ where: { id: body.departmentId } }))) {
      throw unprocessable('That department does not exist')
    }

    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.complaintCategory.create({ data: body })
      await audit.record(tx, {
        action: 'category.created',
        entityType: 'category',
        entityId: created.id,
        payload: { ...body },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return created
    })

    res.status(201).json(category)
  }),
)

consoleRouter.patch(
  '/categories/:id',
  validate(idParam, 'params'),
  validate(categorySchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const changes = req.body as Record<string, unknown>
    const actor = req.user!

    const category = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaintCategory.update({ where: { id }, data: changes })
      await audit.record(tx, {
        action: 'category.updated',
        entityType: 'category',
        entityId: id,
        payload: { changes },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(category)
  }),
)

consoleRouter.delete(
  '/categories/:id',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!

    const used = await prisma.complaint.count({ where: { categoryId: id } })
    if (used > 0) {
      throw unprocessable(
        `${used} ${used === 1 ? 'complaint uses' : 'complaints use'} this category. Switch it off instead so the history keeps reading correctly.`,
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.complaintCategory.delete({ where: { id } })
      await audit.record(tx, {
        action: 'category.deleted',
        entityType: 'category',
        entityId: id,
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    res.status(204).end()
  }),
)

// ---------------------------------------------------------------------------
// Staff — appointing, transferring, and the postings behind both
// ---------------------------------------------------------------------------

/**
 * The staff register as rows.
 *
 * `/admin/users` answers "show me people" for any officer. This answers "show
 * me the establishment" — with the workload and posting history a Super Admin
 * needs before moving anyone.
 */
consoleRouter.get(
  '/staff',
  validate(
    z.object({
      rank: z.nativeEnum(Rank).optional(),
      departmentId: z.coerce.number().int().positive().optional(),
      sectorId: z.coerce.number().int().positive().optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      // Generous: the console filters in the browser, so it asks for the whole
      // establishment at once rather than paginating a few hundred rows.
      size: z.coerce.number().int().min(1).max(1000).default(50),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { rank, departmentId, sectorId, status, q, page, size } = req.query as unknown as {
      rank?: Rank
      departmentId?: number
      sectorId?: number
      status: 'active' | 'inactive' | 'all'
      q?: string
      page: number
      size: number
    }

    const where: Prisma.UserWhereInput = {}
    if (rank) where.rank = rank
    if (status !== 'all') where.isActive = status === 'active'
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
        { phone: { contains: q, mode: 'insensitive' } },
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
          _count: {
            select: {
              ownedComplaints: true,
              workerComplaints: true,
              filedComplaints: true,
            },
          },
        },
        orderBy: [{ rank: 'desc' }, { fullName: 'asc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.user.count({ where }),
    ])

    // Open workload matters more than lifetime totals when deciding a transfer.
    const openCounts = await prisma.complaint.groupBy({
      by: ['assignedOfficerId'],
      where: { status: { in: OPEN_STATUSES }, assignedOfficerId: { in: items.map((i) => i.id) } },
      _count: { _all: true },
    })
    const openJobs = await prisma.complaint.groupBy({
      by: ['assignedWorkerId'],
      where: { status: { in: OPEN_STATUSES }, assignedWorkerId: { in: items.map((i) => i.id) } },
      _count: { _all: true },
    })

    res.json({
      items: items.map((u) => ({
        ...publicUser(u),
        rankLabel: RANK_LABEL[u.rank],
        openCases: openCounts.find((c) => c.assignedOfficerId === u.id)?._count._all ?? 0,
        openJobs: openJobs.find((c) => c.assignedWorkerId === u.id)?._count._all ?? 0,
        lifetimeCases: u._count.ownedComplaints + u._count.workerComplaints,
        filedComplaints: u._count.filedComplaints,
      })),
      total,
      page,
      size,
    })
  }),
)

/** One person's full file: current post, every past post, and their work. */
consoleRouter.get(
  '/staff/:id',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        homeSector: true,
        postings: {
          include: { department: true, zone: true, circle: true, sector: true },
          orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }],
        },
      },
    })
    if (!user) throw notFound('That person does not exist')

    const [openCases, openJobs, recent] = await Promise.all([
      prisma.complaint.count({
        where: { assignedOfficerId: id, status: { in: OPEN_STATUSES } },
      }),
      prisma.complaint.count({
        where: { assignedWorkerId: id, status: { in: OPEN_STATUSES } },
      }),
      prisma.complaint.findMany({
        where: { OR: [{ assignedOfficerId: id }, { assignedWorkerId: id }, { citizenId: id }] },
        include: COMPLAINT_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ])

    res.json({
      ...publicUser(user),
      rankLabel: RANK_LABEL[user.rank],
      // Ended postings included deliberately: the service record is the point.
      postingHistory: user.postings.map((p) => ({
        ...publicPosting(p),
        startedAt: p.startedAt,
        endedAt: p.endedAt,
      })),
      openCases,
      openJobs,
      recentWork: recent.map(publicComplaint),
    })
  }),
)

/** Issue a new password. The Super Admin reads it out; nobody stores it. */
consoleRouter.post(
  '/staff/:id/password',
  validate(idParam, 'params'),
  validate(z.object({ password: z.string().min(8).max(128) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { password } = req.body as { password: string }
    const actor = req.user!

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) throw notFound('That person does not exist')

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { hashedPassword: await hashPassword(password) } })
      // The password itself is never written to the audit trail — only the fact
      // that it was reset, and by whom.
      await audit.record(tx, {
        action: 'staff.password_reset',
        entityType: 'user',
        entityId: id,
        payload: { email: user.email },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      await tx.notification.create({
        data: {
          userId: id,
          title: 'Your password was reset',
          body: `${actor.fullName} issued you a new password. Change it after signing in.`,
        },
      })
    })

    res.json({ ok: true })
  }),
)

const postingSchema = z.object({
  rank: z.nativeEnum(Rank),
  departmentId: z.number().int().positive().nullable().optional(),
  /**
   * Where on the org tree this posting sits. The preferred field — everything
   * downstream (scope, routing, escalation) reads this and nothing else.
   *
   * The zone/circle/sector trio below is accepted only so older callers keep
   * working; whichever is supplied, an orgUnitId is resolved before the row is
   * written. A posting without one is invisible to the whole system.
   */
  orgUnitId: z.number().int().positive().nullable().optional(),
  zoneId: z.number().int().positive().nullable().optional(),
  circleId: z.number().int().positive().nullable().optional(),
  sectorId: z.number().int().positive().nullable().optional(),
  trade: z.nativeEnum(Trade).nullable().optional(),
  employeeCode: z.string().max(32).nullable().optional(),
  /** A second charge alongside the existing one, rather than a replacement. */
  isPrimary: z.boolean().default(false),
})

/** The jurisdiction rules a posting must satisfy, shared by both writers. */
function assertPostingIsRoutable(body: z.infer<typeof postingSchema>): JurisdictionLevel {
  const level = RANK_JURISDICTION[body.rank]

  // An explicit unit satisfies the requirement on its own.
  if (body.orgUnitId) return level

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

  return level
}

/**
 * Give someone an additional charge.
 *
 * Real authorities run on these: an Executive Engineer holds a neighbouring
 * vacant circle until it is filled. Modelling it as a second posting rather
 * than editing the first keeps both jurisdictions live for routing.
 */
consoleRouter.post(
  '/staff/:id/postings',
  validate(idParam, 'params'),
  validate(postingSchema),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id)
    const body = req.body as z.infer<typeof postingSchema>
    const actor = req.user!

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw notFound('That person does not exist')
    if (body.rank === Rank.CITIZEN) throw unprocessable('A citizen holds no posting')

    const level = assertPostingIsRoutable(body)
    const orgUnitId = await org.resolveUnitForPosting(prisma, body)
    if (orgUnitId == null) {
      throw unprocessable('That posting does not correspond to any unit of the authority')
    }
    const designationTitle = await designationFor(prisma, body.departmentId ?? null, body.rank)

    const updated = await prisma.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.posting.updateMany({ where: { userId, endedAt: null }, data: { isPrimary: false } })
      }

      const posting = await tx.posting.create({
        data: {
          userId,
          departmentId: body.departmentId ?? null,
          rank: body.rank,
          level,
          // The field everything downstream actually reads.
          orgUnitId,
          zoneId: level === JurisdictionLevel.ZONE ? body.zoneId : null,
          circleId: level === JurisdictionLevel.CIRCLE ? body.circleId : null,
          sectorId: level === JurisdictionLevel.SECTOR ? body.sectorId : null,
          trade: body.trade ?? null,
          designationTitle,
          employeeCode: body.employeeCode || null,
          isPrimary: body.isPrimary,
        },
      })

      // A person's denormalised rank tracks their most senior live posting, so
      // an added charge can promote but never quietly demote them.
      if (body.isPrimary) {
        await tx.user.update({ where: { id: userId }, data: { rank: body.rank } })
      }

      await audit.record(tx, {
        action: 'posting.created',
        entityType: 'user',
        entityId: userId,
        payload: { postingId: posting.id, rank: body.rank, designationTitle },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      await tx.notification.create({
        data: {
          userId,
          title: 'You have been given an additional charge',
          body: `${designationTitle}. Issued by ${actor.fullName}.`,
        },
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

    res.status(201).json(publicUser(updated))
  }),
)

/**
 * End a posting.
 *
 * Never deleted — the row is what proves who held the charge and when. Refused
 * when it is someone's last one, because a person with no posting receives no
 * work and vanishes from the org chart without anyone deciding that.
 */
consoleRouter.delete(
  '/postings/:id',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!

    const posting = await prisma.posting.findUnique({ where: { id } })
    if (!posting) throw notFound('That posting does not exist')
    if (posting.endedAt) throw badRequest('That posting has already ended')

    const live = await prisma.posting.count({ where: { userId: posting.userId, endedAt: null } })
    if (live <= 1) {
      throw unprocessable(
        'This is their only posting. Transfer them to a new post instead, or deactivate the account.',
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.posting.update({ where: { id }, data: { endedAt: new Date(), isPrimary: false } })

      // Something must remain primary, or the app has no idea which hat to show.
      const remaining = await tx.posting.findFirst({
        where: { userId: posting.userId, endedAt: null },
        orderBy: { rank: 'desc' },
      })
      if (remaining) {
        await tx.posting.update({ where: { id: remaining.id }, data: { isPrimary: true } })
        await tx.user.update({ where: { id: posting.userId }, data: { rank: remaining.rank } })
      }

      await audit.record(tx, {
        action: 'posting.ended',
        entityType: 'user',
        entityId: posting.userId,
        payload: { postingId: id, rank: posting.rank },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    res.status(204).end()
  }),
)

// ---------------------------------------------------------------------------
// Complaints — the override desk
// ---------------------------------------------------------------------------

/**
 * Every complaint in the authority, with the fields a control room sorts by.
 *
 * Deliberately unscoped: this is the only view in the system that sees all of
 * it, which is what makes "no officer holds this" findable.
 */
consoleRouter.get(
  '/complaints',
  validate(
    z.object({
      status: z.nativeEnum(ComplaintStatus).optional(),
      priority: z.nativeEnum(Priority).optional(),
      departmentId: z.coerce.number().int().positive().optional(),
      sectorId: z.coerce.number().int().positive().optional(),
      // Whole slices of the city, so a zone or circle page can link straight
      // into this register rather than showing its own half-version of it.
      circleId: z.coerce.number().int().positive().optional(),
      zoneId: z.coerce.number().int().positive().optional(),
      /** Named problems, rather than making the user compose the filter. */
      flag: z.enum(['overdue', 'unassigned', 'escalated', 'unrouted']).optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      size: z.coerce.number().int().min(1).max(1000).default(50),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { status, priority, departmentId, sectorId, circleId, zoneId, flag, q, page, size } =
      req.query as unknown as {
        status?: ComplaintStatus
        priority?: Priority
        departmentId?: number
        sectorId?: number
        circleId?: number
        zoneId?: number
        flag?: 'overdue' | 'unassigned' | 'escalated' | 'unrouted'
        q?: string
        page: number
        size: number
      }

    const where: Prisma.ComplaintWhereInput = {}
    if (status) where.status = status
    if (priority) where.priority = priority
    if (departmentId) where.departmentId = departmentId
    if (sectorId) where.sectorId = sectorId
    else if (circleId) where.sector = { circleId }
    else if (zoneId) where.sector = { circle: { zoneId } }

    if (flag === 'overdue') {
      where.status = { in: OPEN_STATUSES }
      where.slaDueAt = { lt: new Date() }
    } else if (flag === 'unassigned') {
      where.status = { in: OPEN_STATUSES }
      where.assignedOfficerId = null
    } else if (flag === 'escalated') {
      where.escalationLevel = { gt: 0 }
    } else if (flag === 'unrouted') {
      where.OR = [{ sectorId: null }, { departmentId: null }]
    }

    if (q) {
      const search: Prisma.ComplaintWhereInput[] = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { referenceNo: { contains: q, mode: 'insensitive' } },
      ]
      // `flag: unrouted` already owns OR, so nest both under AND rather than
      // overwriting one with the other.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: search }]
        delete where.OR
      } else {
        where.OR = search
      }
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

    const now = Date.now()
    res.json({
      items: items.map((c) => ({
        ...publicComplaint(c),
        isOverdue:
          c.slaDueAt != null &&
          c.slaDueAt.getTime() < now &&
          (OPEN_STATUSES as ComplaintStatus[]).includes(c.status),
      })),
      total,
      page,
      size,
    })
  }),
)

/**
 * The officials a complaint could be handed to.
 *
 * Ranked by how well they fit — the officer whose posting actually covers this
 * sector first, then everyone else in the department, then the rest. The list
 * is not filtered down to the "correct" answer, because the whole reason to
 * reach for this endpoint is that the correct answer was wrong.
 */
consoleRouter.get(
  '/complaints/:id/candidates',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)

    const complaint = await prisma.complaint.findUnique({
      where: { id },
      include: { sector: { include: { circle: true } } },
    })
    if (!complaint) throw notFound('That complaint does not exist')

    const officials = await prisma.user.findMany({
      where: {
        isActive: true,
        rank: { in: [Rank.SECTION_OFFICER, Rank.CIRCLE_OFFICER, Rank.ZONAL_OFFICER, Rank.HOD] },
      },
      include: {
        postings: {
          where: { endedAt: null },
          include: { department: true, zone: true, circle: true, sector: true },
        },
      },
      orderBy: [{ rank: 'asc' }, { fullName: 'asc' }],
    })

    const open = await prisma.complaint.groupBy({
      by: ['assignedOfficerId'],
      where: { status: { in: OPEN_STATUSES }, assignedOfficerId: { not: null } },
      _count: { _all: true },
    })

    const sectorId = complaint.sectorId
    const circleId = complaint.sector?.circleId ?? null
    const zoneId = complaint.sector?.circle.zoneId ?? null

    /**
     * How tightly one posting covers this complaint's ground.
     *
     * The tightest wins: the officer posted to the sector knows it, the
     * authority-wide General Manager merely contains it. Scoring them equally
     * would float the wrong person to the top of the list.
     */
    function coverage(p: (typeof officials)[number]['postings'][number]): number {
      if (sectorId != null && p.sectorId === sectorId) return 4
      if (circleId != null && p.circleId === circleId) return 3
      if (zoneId != null && p.zoneId === zoneId) return 2
      if (p.level === JurisdictionLevel.AUTHORITY) return 1
      return 0
    }

    const scored = officials.map((u) => {
      // Someone holding two charges is judged on the better-fitting one.
      const best = u.postings.reduce(
        (acc, p) => (coverage(p) > coverage(acc.posting) ? { posting: p } : acc),
        { posting: u.postings[0]! },
      ).posting
      const reach = u.postings.length > 0 ? coverage(best) : 0

      const sameDepartment = u.postings.some((p) => p.departmentId === complaint.departmentId)
      const primary = u.postings.find((p) => p.isPrimary) ?? u.postings[0]

      const reasons: string[] = []
      if (reach === 4) reasons.push('Posted to this sector')
      else if (reach === 3) reasons.push('Covers this circle')
      else if (reach === 2) reasons.push('Covers this zone')
      else if (reach === 1) reasons.push('Authority-wide')
      if (sameDepartment) reasons.push('Same department')

      return {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        rank: u.rank,
        rankLabel: RANK_LABEL[u.rank],
        designationTitle: primary?.designationTitle ?? RANK_LABEL[u.rank],
        department: primary?.department
          ? { id: primary.department.id, name: primary.department.name, icon: primary.department.icon }
          : null,
        jurisdictionLabel:
          primary?.sector != null
            ? `Sector ${primary.sector.number}`
            : (primary?.circle?.name ?? primary?.zone?.name ?? 'Authority-wide'),
        openCases: open.find((o) => o.assignedOfficerId === u.id)?._count._all ?? 0,
        inJurisdiction: reach > 0,
        sameDepartment,
        reasons,
        // Jurisdiction dominates department, so the right officer in the wrong
        // department still outranks a distant one in the right department.
        fit: reach * 2 + (sameDepartment ? 1 : 0),
      }
    })

    scored.sort((a, b) => b.fit - a.fit || a.openCases - b.openCases)

    res.json({ items: scored })
  }),
)

/**
 * Hand a complaint to a named official, whoever they are.
 *
 * GCCE decides routing for the other 99% of cases. This is the deliberate
 * override for the rest — and it records who overrode it and why, because an
 * unexplained reassignment is exactly the move an audit is looking for.
 */
consoleRouter.post(
  '/complaints/:id/assign',
  validate(idParam, 'params'),
  validate(
    z.object({
      officerId: z.number().int().positive(),
      reason: z.string().min(3).max(500),
      priority: z.nativeEnum(Priority).optional(),
      /** Extend or shorten the clock at the same time. */
      slaHours: z.number().int().min(1).max(8760).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { officerId, reason, priority, slaHours } = req.body as {
      officerId: number
      reason: string
      priority?: Priority
      slaHours?: number
    }
    const actor = req.user!

    const [complaint, officer] = await Promise.all([
      prisma.complaint.findUnique({ where: { id } }),
      prisma.user.findUnique({
        where: { id: officerId },
        include: { postings: { where: { endedAt: null } } },
      }),
    ])
    if (!complaint) throw notFound('That complaint does not exist')
    if (!officer) throw notFound('That official does not exist')
    if (!officer.isActive) throw unprocessable('That account is deactivated')
    if (officer.rank === Rank.CITIZEN || officer.rank === Rank.FIELD_WORKER) {
      throw unprocessable(
        'A complaint is owned by an officer, who then allots the work. Assign it to an officer, not a worker.',
      )
    }

    const previous = complaint.assignedOfficerId

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.complaint.update({
        where: { id },
        data: {
          assignedOfficerId: officerId,
          // Handing it to a new owner returns it to their desk: whatever the
          // last officer had started is no longer in flight.
          status: (OPEN_STATUSES as ComplaintStatus[]).includes(complaint.status)
            ? ComplaintStatus.ASSIGNED
            : complaint.status,
          ...(priority ? { priority } : {}),
          ...(slaHours ? { slaDueAt: new Date(Date.now() + slaHours * 3_600_000) } : {}),
        },
        include: COMPLAINT_INCLUDE,
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus: updated.status,
          actorId: actor.id,
          note: `Reassigned to ${officer.fullName} by ${actor.fullName}. ${reason}`,
        },
      })

      const recipients = [
        {
          userId: officerId,
          title: `Assigned to you: ${complaint.title}`,
          body: `${complaint.referenceNo} was assigned to you by ${actor.fullName}. ${reason}`,
          link: `/officer/desk`,
        },
      ]
      if (previous && previous !== officerId) {
        recipients.push({
          userId: previous,
          title: `No longer yours: ${complaint.referenceNo}`,
          body: `${actor.fullName} moved this to ${officer.fullName}. ${reason}`,
          link: `/admin/complaints`,
        })
      }
      await tx.notification.createMany({ data: recipients })

      await audit.record(tx, {
        action: 'complaint.reassigned',
        entityType: 'complaint',
        entityId: id,
        payload: {
          fromOfficerId: previous,
          toOfficerId: officerId,
          reason,
          priority: priority ?? null,
          slaHours: slaHours ?? null,
        },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      /*
       * The routing override, as a label rather than as prose.
       *
       * This is one of the three feedback signals W2.3 wants. It is recorded
       * from the console because the console is the only place the product can
       * currently produce it — there is no officer-facing re-route, tracked as
       * F-02 in the fault register. Until that exists, every routing override
       * in the data was performed by a Super Admin rather than by the officer
       * who actually saw the misroute, and anything trained on it should be
       * read with that in mind.
       */
      await decisions.resolve(tx, {
        complaintId: id,
        kind: DecisionKind.ROUTE,
        outcome:
          previous === officerId ? DecisionOutcome.CONFIRMED : DecisionOutcome.OVERRIDDEN,
        overriddenTo: String(officerId),
        overriddenById: actor.id,
        overrideReason: reason,
      })

      return updated
    })

    res.json(publicComplaint(saved))
  }),
)

/**
 * Correct a complaint's routing fields by hand.
 *
 * GCCE's classifier is keyword-based and will sometimes put a broken streetlight
 * in Civil. Rather than pretend otherwise, the Super Admin can set the
 * department, sector, category or priority directly — and the correction is
 * recorded as one, which is what makes the classifier improvable later.
 */
consoleRouter.patch(
  '/complaints/:id',
  validate(idParam, 'params'),
  validate(
    z.object({
      categoryId: z.number().int().positive().nullable().optional(),
      departmentId: z.number().int().positive().nullable().optional(),
      sectorId: z.number().int().positive().nullable().optional(),
      priority: z.nativeEnum(Priority).optional(),
      status: z.nativeEnum(ComplaintStatus).optional(),
      slaHours: z.number().int().min(1).max(8760).optional(),
      reason: z.string().min(3).max(500),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { reason, slaHours, ...changes } = req.body as Record<string, unknown> & {
      reason: string
      slaHours?: number
      status?: ComplaintStatus
    }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')

    const data: Prisma.ComplaintUpdateInput = {}
    if ('categoryId' in changes) data.category = changes.categoryId ? { connect: { id: changes.categoryId as number } } : { disconnect: true }
    if ('departmentId' in changes) data.department = changes.departmentId ? { connect: { id: changes.departmentId as number } } : { disconnect: true }
    if ('sectorId' in changes) data.sector = changes.sectorId ? { connect: { id: changes.sectorId as number } } : { disconnect: true }
    if (changes.priority) data.priority = changes.priority as Priority
    if (changes.status) data.status = changes.status
    if (slaHours) data.slaDueAt = new Date(Date.now() + slaHours * 3_600_000)

    // Closing by hand must still stamp the timestamps the rest of the app reads.
    if (changes.status === ComplaintStatus.RESOLVED && !complaint.resolvedAt) {
      data.resolvedAt = new Date()
    }
    if (changes.status === ComplaintStatus.CLOSED) {
      data.closedAt = new Date()
      if (!complaint.resolvedAt) data.resolvedAt = new Date()
    }

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.complaint.update({ where: { id }, data, include: COMPLAINT_INCLUDE })

      if (changes.status && changes.status !== complaint.status) {
        await tx.complaintStatusHistory.create({
          data: {
            complaintId: id,
            fromStatus: complaint.status,
            toStatus: changes.status,
            actorId: actor.id,
            note: `Set by ${actor.fullName}. ${reason}`,
          },
        })
      }

      await audit.record(tx, {
        action: 'complaint.corrected',
        entityType: 'complaint',
        entityId: id,
        payload: { changes: { ...changes, slaHours: slaHours ?? null }, reason },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return updated
    })

    res.json(publicComplaint(saved))
  }),
)

// ---------------------------------------------------------------------------
// Drill-down — one record and everything hanging off it
// ---------------------------------------------------------------------------
//
// The console navigates the way the authority is actually shaped: the city
// divides into zones, circles and sectors; the organisation divides into
// departments. Each endpoint below answers "what is this, and what sits under
// it", so a page can be a record with its children rather than a list the
// reader has to correlate against another list in another screen.

/** Complaint counts for one slice of the register, in the shape every header shows. */
async function complaintTally(where: Prisma.ComplaintWhereInput) {
  const now = new Date()
  const [total, open, overdue, unassigned] = await Promise.all([
    prisma.complaint.count({ where }),
    prisma.complaint.count({ where: { ...where, status: { in: OPEN_STATUSES } } }),
    prisma.complaint.count({
      where: { ...where, status: { in: OPEN_STATUSES }, slaDueAt: { lt: now } },
    }),
    prisma.complaint.count({
      where: { ...where, status: { in: OPEN_STATUSES }, assignedOfficerId: null },
    }),
  ])
  return { total, open, overdue, unassigned }
}

const STAFF_POSTING_INCLUDE = {
  user: { select: { id: true, fullName: true, email: true, isActive: true, rank: true } },
  department: { select: { id: true, name: true, icon: true } },
  // Where they actually sit. The zone/circle/sector trio below is carried only
  // for rows written before the tree existed.
  orgUnit: { select: { id: true, name: true, kindLabel: true, depth: true } },
  sector: { select: { id: true, number: true, name: true } },
  circle: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
} as const

type StaffPosting = Prisma.PostingGetPayload<{ include: typeof STAFF_POSTING_INCLUDE }>
type OpenCaseCount = { assignedOfficerId: number | null; _count: { _all: number } }

/**
 * How many open complaints each of these officers is carrying.
 *
 * One grouped query rather than a count per row: a department page listing
 * forty officers would otherwise fire forty queries to fill one column.
 */
async function openCasesFor(userIds: number[]): Promise<OpenCaseCount[]> {
  if (userIds.length === 0) return []
  const rows = await prisma.complaint.groupBy({
    by: ['assignedOfficerId'],
    where: { status: { in: OPEN_STATUSES }, assignedOfficerId: { in: userIds } },
    _count: { _all: true },
  })
  return rows as OpenCaseCount[]
}

/** A roster of people, in the one shape every drill-down page renders. */
function staffRows(postings: StaffPosting[], openCases: OpenCaseCount[]) {
  return postings.map((p) => ({
    postingId: p.id,
    userId: p.user.id,
    fullName: p.user.fullName,
    email: p.user.email,
    isActive: p.user.isActive,
    rank: p.rank,
    rankLabel: RANK_LABEL[p.rank],
    designationTitle: p.designationTitle ?? RANK_LABEL[p.rank],
    department: p.department,
    trade: p.trade,
    employeeCode: p.employeeCode,
    unit: p.orgUnit,
    // Named by the layer the person is actually posted to, so this reads the
    // same whatever depth the authority is configured to.
    jurisdictionLabel: p.orgUnit
      ? `${p.orgUnit.kindLabel} ${p.orgUnit.name}`
      : p.sector
        ? `Sector ${p.sector.number}`
        : (p.circle?.name ?? p.zone?.name ?? 'Authority-wide'),
    openCases: openCases.find((o) => o.assignedOfficerId === p.user.id)?._count._all ?? 0,
  }))
}

/*
 * The zone / circle / sector drill-downs used to live here. Those three screens
 * became one — `/admin/org/:unitId` renders any depth — so the endpoints behind
 * them went with the pages. `GET /console/units/:id` serves all of them now.
 */

/**
 * One department and everything inside it.
 *
 * Its tiers, the titles those tiers carry, the categories that route to it, its
 * staff and its works — things that used to be four separate registers a reader
 * had to hold in their head at once and join up themselves.
 */
consoleRouter.get(
  '/departments/:id/detail',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)

    const department = await prisma.department.findUnique({
      where: { id },
      include: {
        designations: true,
        categories: {
          include: { _count: { select: { complaints: true } } },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    })
    if (!department) throw notFound('That department does not exist')

    const postings = await prisma.posting.findMany({
      where: { departmentId: id, endedAt: null },
      include: STAFF_POSTING_INCLUDE,
      orderBy: [{ rank: 'desc' }, { id: 'asc' }],
    })

    const [tally, open, held] = await Promise.all([
      complaintTally({ departmentId: id }),
      openCasesFor(postings.map((p) => p.user.id)),
      prisma.posting.groupBy({
        by: ['rank'],
        where: { departmentId: id, endedAt: null },
        _count: { _all: true },
      }),
    ])

    // The chain of command as tiers, senior first. This department page *is*
    // the org chart for this department, rather than pointing at another screen.
    const tiers = [...new Set(postings.map((p) => p.rank))]
      .sort((a, b) => RANK_LEVEL[b] - RANK_LEVEL[a])
      .map((rank) => ({
        rank,
        rankLabel: RANK_LABEL[rank],
        designation: department.designations.find((d) => d.rank === rank)?.title ?? RANK_LABEL[rank],
        count: held.find((h) => h.rank === rank)?._count._all ?? 0,
      }))

    res.json({
      department: {
        id: department.id,
        code: department.code,
        name: department.name,
        nameHi: department.nameHi,
        description: department.description,
        icon: department.icon,
        status: department.status,
        roadmapNote: department.roadmapNote,
        sortOrder: department.sortOrder,
      },
      tiers,
      designations: department.designations
        .slice()
        .sort((a, b) => RANK_LEVEL[b.rank] - RANK_LEVEL[a.rank])
        .map((d) => ({
          id: d.id,
          rank: d.rank,
          rankLabel: RANK_LABEL[d.rank],
          title: d.title,
          titleHi: d.titleHi,
          shortTitle: d.shortTitle,
          holders: held.find((h) => h.rank === d.rank)?._count._all ?? 0,
        })),
      categories: department.categories.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        nameHi: c.nameHi,
        icon: c.icon,
        defaultSlaHours: c.defaultSlaHours,
        keywords: c.keywords,
        trade: c.trade,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        complaintCount: c._count.complaints,
      })),
      staff: staffRows(postings, open),
      complaints: tally,
    })
  }),
)

// ---------------------------------------------------------------------------
// Citizens — the public, kept apart from the establishment
// ---------------------------------------------------------------------------
//
// A citizen and an officer share a table in Postgres and nothing else. One is
// the authority; the other is the public it answers to. Listing them together
// makes both harder to read, and the questions you ask of each are different:
// an officer's row is about workload, a citizen's is about what they filed and
// whether they were satisfied.

consoleRouter.get(
  '/citizens',
  validate(
    z.object({
      sectorId: z.coerce.number().int().positive().optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      size: z.coerce.number().int().min(1).max(1000).default(200),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { sectorId, q, page, size } = req.query as unknown as {
      sectorId?: number
      q?: string
      page: number
      size: number
    }

    const where: Prisma.UserWhereInput = { rank: Rank.CITIZEN }
    if (sectorId) where.homeSectorId = sectorId
    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          homeSector: { select: { id: true, number: true, name: true } },
          _count: { select: { filedComplaints: true } },
        },
        orderBy: { fullName: 'asc' },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.user.count({ where }),
    ])

    const ids = items.map((i) => i.id)
    const [openFiled, rated] = await Promise.all([
      prisma.complaint.groupBy({
        by: ['citizenId'],
        where: { citizenId: { in: ids }, status: { in: OPEN_STATUSES } },
        _count: { _all: true },
      }),
      prisma.complaint.groupBy({
        by: ['citizenId'],
        where: { citizenId: { in: ids }, feedbackRating: { not: null } },
        _avg: { feedbackRating: true },
      }),
    ])

    res.json({
      items: items.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        isActive: u.isActive,
        homeSector: u.homeSector,
        filed: u._count.filedComplaints,
        openFiled: openFiled.find((o) => o.citizenId === u.id)?._count._all ?? 0,
        /** How they rated the authority's work — the only feedback loop there is. */
        avgRating: rated.find((r) => r.citizenId === u.id)?._avg.feedbackRating ?? null,
        createdAt: u.createdAt,
      })),
      total,
      page,
      size,
    })
  }),
)

consoleRouter.get(
  '/citizens/:id',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)

    const citizen = await prisma.user.findUnique({
      where: { id },
      include: { homeSector: { select: { id: true, number: true, name: true } } },
    })
    if (!citizen) throw notFound('That person does not exist')
    if (citizen.rank !== Rank.CITIZEN) {
      throw unprocessable('That account is staff — look for them in the staff register')
    }

    const complaints = await prisma.complaint.findMany({
      where: { citizenId: id },
      include: COMPLAINT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })

    const now = Date.now()
    res.json({
      citizen: {
        id: citizen.id,
        fullName: citizen.fullName,
        email: citizen.email,
        phone: citizen.phone,
        isActive: citizen.isActive,
        homeSector: citizen.homeSector,
        createdAt: citizen.createdAt,
      },
      complaints: complaints.map((c) => ({
        ...publicComplaint(c),
        isOverdue:
          c.slaDueAt != null &&
          c.slaDueAt.getTime() < now &&
          (OPEN_STATUSES as ComplaintStatus[]).includes(c.status),
      })),
    })
  }),
)

// ---------------------------------------------------------------------------
// Event log — the complaint lifecycle as process-mining data
// ---------------------------------------------------------------------------
//
// The system already holds an event log; these two endpoints let someone take
// it out and look at it in a tool built for that. Super Admin only, for the
// same reason the rest of this router is: the full lifecycle of every complaint
// in the authority, with the officer on each transition, is a picture of who is
// slow and who is not, and that is not a view to hand out casually.

const eventLogRange = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

/** Row count, case count and time span — what the download control shows. */
consoleRouter.get(
  '/event-log/summary',
  validate(eventLogRange, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as unknown as { from?: Date; to?: Date }
    res.json(await eventLog.summariseEventLog({ from, to }))
  }),
)

/**
 * The log as CSV, ready for pm4py without editing.
 *
 * Streamed a chunk at a time rather than serialised into one string: at the
 * volumes this is built for, holding the entire log in memory to hand it to
 * `res.send` is a needless spike, and the client starts receiving immediately.
 */
consoleRouter.get(
  '/event-log.csv',
  validate(eventLogRange, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as unknown as { from?: Date; to?: Date }
    const rows = await eventLog.buildEventLog({ from, to })

    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="drishti-event-log-${stamp}.csv"`)

    res.write(eventLog.CSV_COLUMNS.join(',') + '\r\n')
    for (const row of rows) res.write(eventLog.toCsvRow(row) + '\r\n')
    res.end()
  }),
)

// ---------------------------------------------------------------------------
// Decisions — what the engines judged, and whether anyone disagreed
// ---------------------------------------------------------------------------
//
// The register behind /admin/decisions. Super Admin only, like the rest of this
// router: how often the engines are overruled is a statement about how well the
// system works, and it belongs to the person accountable for it before it
// belongs to anyone else.

const decisionQuery = z.object({
  kind: z.nativeEnum(DecisionKind).optional(),
  outcome: z.nativeEnum(DecisionOutcome).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(50),
})

consoleRouter.get(
  '/decisions',
  validate(decisionQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { kind, outcome, from, to, page, size } = req.query as unknown as {
      kind?: DecisionKind
      outcome?: DecisionOutcome
      from?: Date
      to?: Date
      page: number
      size: number
    }

    const where: Prisma.DecisionWhereInput = {}
    if (kind) where.kind = kind
    if (outcome) where.outcome = outcome
    if (from || to) {
      where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) }
    }

    const [items, total, agreement] = await Promise.all([
      prisma.decision.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * size,
        take: size,
        include: {
          complaint: { select: { id: true, referenceNo: true, title: true } },
          actor: { select: { id: true, fullName: true } },
          overriddenBy: { select: { id: true, fullName: true } },
        },
      }),
      prisma.decision.count({ where }),
      // Unfiltered on purpose: the summary describes the whole record, so it
      // does not move when someone narrows the table beneath it.
      decisions.agreementByKind(prisma),
    ])

    res.json({ items, total, page, size, agreement })
  }),
)

// ---------------------------------------------------------------------------
// The autonomy gate console
// ---------------------------------------------------------------------------
//
// A smaller screen than the one Wave 4 was specified around, because the thing
// it was meant to chart does not exist. There is no coverage-over-time when
// coverage is zero, and no override rate when nothing is executed to override.
//
// What is left is worth a screen on its own: the thresholds the calibration
// derived and what each one measured, the review queue ordered by how uncertain
// the system is rather than by age, and the complaints whose own history says
// they look finished. The last of those was found by accident and is the most
// immediately useful thing the gate produces.

consoleRouter.get(
  '/autonomy',
  asyncHandler(async (_req, res) => {
    const { gateInfo } = await import('../services/autonomy.js')
    const spec = gateInfo()

    const where: Prisma.DecisionWhereInput = {
      kind: DecisionKind.NEXT_ACTION,
      source: 'autonomy',
    }

    const [total, assessments, byAction] = await Promise.all([
      prisma.decision.count({ where }),
      // Least confident first: the queue exists to put the cases the system
      // understands worst in front of a person, which is the opposite of the
      // oldest-first ordering every other register uses.
      prisma.decision.findMany({
        where,
        orderBy: [{ confidence: 'asc' }, { id: 'desc' }],
        take: 50,
        include: {
          complaint: {
            select: {
              id: true,
              referenceNo: true,
              title: true,
              status: true,
              createdAt: true,
              orgUnit: { select: { id: true, name: true, kindLabel: true } },
            },
          },
        },
      }),
      prisma.decision.groupBy({ by: ['chosen'], where, _count: { _all: true } }),
    ])

    res.json({
      spec: spec
        ? {
            modelVersion: spec.modelVersion,
            thresholds: spec.thresholds,
            riskOfAction: spec.riskOfAction,
            note: spec.note,
          }
        : null,
      total,
      queue: assessments.map((d) => ({
        id: d.id,
        complaint: d.complaint,
        chosen: d.chosen,
        confidence: d.confidence,
        feasibleSet: d.feasibleSet,
        reasons: d.reasons,
        createdAt: d.createdAt,
      })),
      byAction: byAction
        .map((row) => ({ action: row.chosen, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
    })
  }),
)
