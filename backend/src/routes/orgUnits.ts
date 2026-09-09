/**
 * The org tree, as the Super Admin shapes it.
 *
 * This is the router behind the feature that moves the hierarchy out of the
 * schema and into the panel. Units are directories: create one under any
 * parent, at any depth, and every layer behaves identically. How a layer
 * *behaves* — how long work may sit there, whether it may dispatch to a crew —
 * is configured per department, because a department that runs two layers and
 * one that runs five are both legitimate.
 *
 * Kept apart from console.ts on purpose: that file is already long, and the
 * tree is a coherent subject of its own.
 *
 * Everything here is Super Admin only, reads included — knowing the full shape
 * of the authority is itself a privilege. Every write is audited inside the
 * same transaction, because reshaping the org chart is precisely where an
 * unaccountable change would do the most damage.
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireOfficer, requireSuperAdmin } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { OPEN_STATUSES } from '../services/gcce.js'
import * as org from '../services/orgTree.js'
import {
  asyncHandler,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from '../utils/http.js'

export const orgUnitsRouter: Router = Router()

/**
 * Reading the tree is open to every officer; reshaping it is not.
 *
 * This is what makes one console serve the whole authority. An officer sees the
 * tree from where they stand — their own unit and everything beneath it — and
 * the same screen renders it. Only the Super Admin may add, rename or remove a
 * unit, or change how deep a department runs.
 */
orgUnitsRouter.use(authenticate, requireOfficer)

const idParam = z.object({ id: z.coerce.number().int().positive() })

/**
 * Refuse a unit outside the caller's subtree.
 *
 * Seniority is not the test — position is. A Zone II officer has no business
 * reading Zone I, however senior they are, and someone posted at the root has
 * no limit at all.
 */
async function assertInScope(userId: number, unitId: number) {
  if (!(await org.hasScope(prisma, userId, unitId))) {
    throw forbidden('That part of the authority is outside your posting')
  }
}

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/** The root, so the panel has an entry point without having to know an id. */
orgUnitsRouter.get(
  '/units',
  asyncHandler(async (req, res) => {
    // Everyone gets an entry point, but not necessarily the city: an officer
    // enters the tree at their own posting, which is what makes this one screen
    // work for a sector officer and the CEO alike.
    const scope = await org.unitsInScope(prisma, req.user!.id)
    if (scope === null) {
      const root = await org.getRoot(prisma)
      if (!root) throw notFound('No org tree has been built yet')
      return res.json({ rootId: root.id })
    }

    const postings = await prisma.posting.findMany({
      where: { userId: req.user!.id, endedAt: null, orgUnitId: { not: null } },
      include: { orgUnit: true },
    })
    const highest = postings
      .map((p) => p.orgUnit!)
      .filter(Boolean)
      .sort((a, b) => a.depth - b.depth)[0]

    if (!highest) throw notFound('You are not posted to any part of the authority')
    res.json({ rootId: highest.id })
  }),
)

/**
 * One unit, with everything the drill-down screen needs in a single response:
 * where it sits, what is under it, who is posted to it, and how it is doing.
 *
 * The same payload shape serves a sector and the whole city, which is what lets
 * one screen render any layer.
 */
orgUnitsRouter.get(
  '/units/:id',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined

    await assertInScope(req.user!.id, id)

    const unit = await prisma.orgUnit.findUnique({ where: { id } })
    if (!unit) throw notFound('Unit not found')

    const scope = await org.unitsInScope(prisma, req.user!.id)
    const reachable = (unitId: number) => scope === null || scope.includes(unitId)

    const [crumbs, children, roster, stats, removal, parent] = await Promise.all([
      org.breadcrumb(prisma, id),
      org.childrenWithRollups(prisma, id, departmentId),
      org.rosterAt(prisma, id, departmentId),
      org.rollup(prisma, id, departmentId),
      org.describeRemoval(prisma, id),
      unit.parentId ? prisma.orgUnit.findUnique({ where: { id: unit.parentId } }) : null,
    ])

    res.json({
      unit: {
        id: unit.id,
        code: unit.code,
        name: unit.name,
        nameHi: unit.nameHi,
        kindLabel: unit.kindLabel,
        depth: unit.depth,
        isLeaf: unit.isLeaf,
        isActive: unit.isActive,
        population: unit.population,
        centroidLat: unit.centroidLat,
        centroidLon: unit.centroidLon,
      },
      // An officer sees where their unit sits, but only the parts they are
      // posted to are openable — showing a trail that 403s on click would be
      // worse than showing none at all.
      parent:
        parent && reachable(parent.id)
          ? { id: parent.id, name: parent.name, kindLabel: parent.kindLabel }
          : null,
      breadcrumb: crumbs.map((c) => ({ ...c, reachable: reachable(c.id) })),
      stats,
      children: children.map((c) => ({
        id: c.unit.id,
        code: c.unit.code,
        name: c.unit.name,
        kindLabel: c.unit.kindLabel,
        depth: c.unit.depth,
        isLeaf: c.unit.isLeaf,
        isActive: c.unit.isActive,
        stats: c.stats,
      })),
      roster: roster.map((p) => ({
        postingId: p.id,
        userId: p.user.id,
        fullName: p.user.fullName,
        email: p.user.email,
        phone: p.user.phone,
        designationTitle: p.designationTitle,
        employeeCode: p.employeeCode,
        department: p.department,
      })),
      removal,
    })
  }),
)

/**
 * Resolve a legacy zone/circle/sector id to its place on the tree.
 *
 * Old links across the console still carry the pre-tree ids. Rather than leave
 * a second set of geography screens alive to serve them, those pages became
 * redirects that come through here. Circles were dissolved when the tree was
 * built, so a circle resolves to the zone that contained it.
 *
 * Delete this once no stored link refers to the old ids.
 */
orgUnitsRouter.get(
  '/units/resolve/:kind/:id',
  validate(
    z.object({
      kind: z.enum(['sector', 'circle', 'zone']),
      id: z.coerce.number().int().positive(),
    }),
    'params',
  ),
  asyncHandler(async (req, res) => {
    const { kind, id } = req.params as unknown as { kind: string; id: number }

    let code: string | null = null
    if (kind === 'sector') {
      const sector = await prisma.sector.findUnique({ where: { id: Number(id) } })
      code = sector ? `SEC-${sector.number}` : null
    } else if (kind === 'zone') {
      const zone = await prisma.zone.findUnique({ where: { id: Number(id) } })
      code = zone?.code ?? null
    } else {
      // A circle no longer has a unit of its own; its work sits with its zone.
      const circle = await prisma.circle.findUnique({
        where: { id: Number(id) },
        include: { zone: true },
      })
      code = circle?.zone.code ?? null
    }

    if (!code) throw notFound('No unit corresponds to that record')
    const unit = await prisma.orgUnit.findUnique({ where: { code } })
    if (!unit) throw notFound('No unit corresponds to that record')

    res.json({ unitId: unit.id, name: unit.name, kindLabel: unit.kindLabel })
  }),
)

// ---------------------------------------------------------------------------
// Shaping the tree
// ---------------------------------------------------------------------------

const createUnitSchema = z.object({
  parentId: z.number().int().positive(),
  code: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, digits and hyphens only'),
  name: z.string().min(2).max(120),
  nameHi: z.string().max(120).optional(),
  kindLabel: z.string().min(2).max(40).optional(),
})

/** Add a unit. Adding the first child of a leaf is what creates a new layer. */
orgUnitsRouter.post(
  '/units',
  requireSuperAdmin,
  validate(createUnitSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createUnitSchema>

    const parent = await prisma.orgUnit.findUnique({ where: { id: body.parentId } })
    if (!parent) throw badRequest('That parent unit does not exist')

    const clash = await prisma.orgUnit.findUnique({ where: { code: body.code } })
    if (clash) throw conflict(`The code ${body.code} is already in use`)

    const unit = await prisma.$transaction(async (tx) => {
      const created = await org.createUnit(tx, body)
      await audit.record(tx, {
        action: 'org.unit.created',
        entityType: 'orgUnit',
        entityId: created.id,
        payload: {
          code: created.code,
          name: created.name,
          parentId: parent.id,
          depth: created.depth,
        },
        actorId: req.user!.id,
        actorLabel: req.user!.fullName,
        source: 'api',
      })
      return created
    })

    res.status(201).json({ unit })
  }),
)

const updateUnitSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  nameHi: z.string().max(120).nullable().optional(),
  kindLabel: z.string().min(2).max(40).optional(),
  population: z.number().int().min(0).nullable().optional(),
  centroidLat: z.number().min(-90).max(90).nullable().optional(),
  centroidLon: z.number().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().optional(),
})

orgUnitsRouter.patch(
  '/units/:id',
  requireSuperAdmin,
  validate(idParam, 'params'),
  validate(updateUnitSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const existing = await prisma.orgUnit.findUnique({ where: { id } })
    if (!existing) throw notFound('Unit not found')

    const unit = await prisma.$transaction(async (tx) => {
      const updated = await tx.orgUnit.update({ where: { id }, data: req.body })
      await audit.record(tx, {
        action: 'org.unit.updated',
        entityType: 'orgUnit',
        entityId: id,
        payload: { before: existing, after: updated },
        actorId: req.user!.id,
        actorLabel: req.user!.fullName,
        source: 'api',
      })
      return updated
    })

    res.json({ unit })
  }),
)

/**
 * Remove a unit.
 *
 * Refused while anything still points at it. A deleted unit with live
 * complaints is exactly how work disappears silently, so the caller is told
 * what to move first rather than being allowed to orphan it.
 */
orgUnitsRouter.delete(
  '/units/:id',
  requireSuperAdmin,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const unit = await prisma.orgUnit.findUnique({ where: { id } })
    if (!unit) throw notFound('Unit not found')
    if (unit.parentId == null) throw unprocessable('The root unit cannot be removed')

    const removal = await org.describeRemoval(prisma, id)
    if (!removal.canRemove) {
      throw unprocessable(`Move these before removing ${unit.name}: ${removal.blockers.join(', ')}`,
      )
    }

    const parentId = unit.parentId

    await prisma.$transaction(async (tx) => {
      await tx.orgUnit.delete({ where: { id } })

      // The parent may have just become a leaf again.
      const siblings = await tx.orgUnit.count({ where: { parentId } })
      if (siblings === 0) {
        await tx.orgUnit.update({ where: { id: parentId }, data: { isLeaf: true } })
      }

      await audit.record(tx, {
        action: 'org.unit.removed',
        entityType: 'orgUnit',
        entityId: id,
        payload: { code: unit.code, name: unit.name, parentId },
        actorId: req.user!.id,
        actorLabel: req.user!.fullName,
        source: 'api',
      })
    })

    res.json({ removed: true })
  }),
)

// ---------------------------------------------------------------------------
// Layer configuration — how deep a department runs
// ---------------------------------------------------------------------------

orgUnitsRouter.get(
  '/departments/:id/layers',
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const departmentId = Number(req.params.id)
    const department = await prisma.department.findUnique({ where: { id: departmentId } })
    if (!department) throw notFound('Department not found')

    const layers = await org.layersFor(prisma, departmentId)

    // How many units exist at each depth, and how many are actually staffed for
    // this department. A layer that is configured but unstaffed is a silent
    // hole: complaints will fall straight through it.
    const enriched = await Promise.all(
      layers.map(async (layer) => {
        const units = await prisma.orgUnit.findMany({
          where: { depth: layer.depth, isActive: true },
          select: { id: true },
        })
        const unitIds = units.map((u) => u.id)
        const staffed = await prisma.posting.groupBy({
          by: ['orgUnitId'],
          where: {
            orgUnitId: { in: unitIds },
            departmentId,
            endedAt: null,
            user: { isActive: true },
          },
        })
        return {
          ...layer,
          unitCount: unitIds.length,
          staffedUnitCount: staffed.length,
          vacantUnitCount: unitIds.length - staffed.length,
        }
      }),
    )

    res.json({
      department: {
        id: department.id,
        code: department.code,
        name: department.name,
        icon: department.icon,
      },
      layers: enriched,
    })
  }),
)

const layerSchema = z.object({
  depth: z.number().int().min(0).max(9),
  name: z.string().min(2).max(40),
  namePlural: z.string().min(2).max(40),
  canDispatch: z.boolean(),
  slaHours: z.number().int().min(1).max(8760),
  minPostings: z.number().int().min(0).max(100),
})

/**
 * Replace a department's layer configuration.
 *
 * Sent whole rather than patched a row at a time, because the layers are only
 * meaningful as a set: depths must run contiguously from 0, and at most one
 * layer may dispatch — the deepest. Validating the set is the only way to
 * guarantee both.
 */
orgUnitsRouter.put(
  '/departments/:id/layers',
  requireSuperAdmin,
  validate(idParam, 'params'),
  validate(z.object({ layers: z.array(layerSchema).min(1).max(10) })),
  asyncHandler(async (req, res) => {
    const departmentId = Number(req.params.id)
    const department = await prisma.department.findUnique({ where: { id: departmentId } })
    if (!department) throw notFound('Department not found')

    const layers = (req.body.layers as z.infer<typeof layerSchema>[])
      .slice()
      .sort((a, b) => a.depth - b.depth)

    // Depths must start at 0 and be contiguous — a gap would describe a layer
    // whose parent does not exist.
    for (const [index, layer] of layers.entries()) {
      if (layer.depth !== index) {
        throw unprocessable('Layer depths must start at 0 and rise by one, with no gaps')
      }
    }

    const dispatchers = layers.filter((l) => l.canDispatch)
    if (dispatchers.length > 1) {
      throw unprocessable('Only one layer may dispatch work — normally the deepest')
    }
    if (dispatchers.length === 1 && dispatchers[0]!.depth !== layers.length - 1) {
      throw unprocessable('Only the deepest layer may dispatch work; a parent unit delegates downward instead',
      )
    }

    // Refuse to configure away a layer that still holds live work.
    const existing = await org.layersFor(prisma, departmentId)
    const removedDepths = existing.map((l) => l.depth).filter((d) => d >= layers.length)

    if (removedDepths.length > 0) {
      const stranded = await prisma.complaint.count({
        where: {
          departmentId,
          status: { in: OPEN_STATUSES },
          orgUnit: { depth: { in: removedDepths } },
        },
      })
      if (stranded > 0) {
        throw unprocessable(`${stranded} open complaint${stranded === 1 ? '' : 's'} still sit at the layer you are removing. Resolve or move them first.`,
        )
      }
    }

    const saved = await prisma.$transaction(async (tx) => {
      const before = await tx.departmentLayer.findMany({ where: { departmentId } })
      await tx.departmentLayer.deleteMany({ where: { departmentId } })
      await tx.departmentLayer.createMany({
        data: layers.map((l) => ({ ...l, departmentId })),
      })
      const after = await tx.departmentLayer.findMany({
        where: { departmentId },
        orderBy: { depth: 'asc' },
      })
      await audit.record(tx, {
        action: 'org.layers.configured',
        entityType: 'department',
        entityId: departmentId,
        payload: { before, after },
        actorId: req.user!.id,
        actorLabel: req.user!.fullName,
        source: 'api',
      })
      return after
    })

    res.json({ layers: saved })
  }),
)
