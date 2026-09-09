/**
 * The org tree — one uniform contract for every layer.
 *
 * The old hierarchy hard-coded a ladder (Section -> Circle -> Zonal -> HOD) in
 * an enum, so adding a layer meant a migration and a rewrite of every
 * permission check. Here the ladder is just the tree: escalating is walking to
 * `parentId`, and a person's authority is the subtree beneath their posting.
 *
 * The rule that keeps behaviour predictable as layers are added:
 *
 *   Every unit exposes the same six facets — inbox, roster, children, parent,
 *   dispatch, rollup — and only the layer nearest the ground may dispatch work
 *   to a crew member. A parent unit delegates downward instead.
 *
 * "Nearest the ground" is per department, not per tree: the spine is shared, so
 * a department running two layers stops at depth 1 while another runs to depth
 * 2 on the same units. See `departmentLeafDepth`.
 *
 * Subtree questions are answered from the materialised `path` rather than a
 * recursive query, so a City-level rollup is one indexed scan.
 */
import type { Prisma, PrismaClient, OrgUnit } from '@prisma/client'

export type Db = PrismaClient | Prisma.TransactionClient

// ---------------------------------------------------------------------------
// Navigation — the directory operations
// ---------------------------------------------------------------------------

export const getUnit = (db: Db, id: number) => db.orgUnit.findUnique({ where: { id } })

/** The root of the whole tree — the city. */
export const getRoot = (db: Db) => db.orgUnit.findFirst({ where: { parentId: null } })

/**
 * Ancestors of a unit, root first. Parsed from the materialised path, so this
 * costs one query no matter how deep the tree grows.
 */
export async function getAncestors(db: Db, unit: OrgUnit): Promise<OrgUnit[]> {
  const ids = unit.path
    .split('/')
    .filter(Boolean)
    .map(Number)
    .filter((id) => id !== unit.id)
  if (ids.length === 0) return []
  const rows = await db.orgUnit.findMany({ where: { id: { in: ids } } })
  return rows.sort((a, b) => a.depth - b.depth)
}

/** Breadcrumb for the UI: Noida / Zone I / Sector 5. */
export async function breadcrumb(db: Db, unitId: number) {
  const unit = await getUnit(db, unitId)
  if (!unit) return []
  const ancestors = await getAncestors(db, unit)
  return [...ancestors, unit].map((u) => ({
    id: u.id,
    name: u.name,
    kindLabel: u.kindLabel,
    depth: u.depth,
  }))
}

export const getChildren = (db: Db, parentId: number) =>
  db.orgUnit.findMany({ where: { parentId, isActive: true }, orderBy: { name: 'asc' } })

/**
 * Every unit id at or below this one — the scope a posting here confers.
 *
 * `path STARTS WITH` is the whole trick: a unit's path contains its own id, so
 * the prefix match returns the unit and its entire subtree in one go.
 */
export async function getSubtreeIds(db: Db, unitId: number): Promise<number[]> {
  const unit = await getUnit(db, unitId)
  if (!unit) return []
  const rows = await db.orgUnit.findMany({
    where: { path: { startsWith: unit.path } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * Units at or below this one that sit at the ground floor.
 *
 * Pass a department to get ITS ground floor; without one you get the tree's
 * structural leaves, which is only the right answer for a department that runs
 * the full depth.
 */
export async function getLeavesBelow(
  db: Db,
  unitId: number,
  departmentId?: number,
): Promise<OrgUnit[]> {
  const unit = await getUnit(db, unitId)
  if (!unit) return []

  const depth = departmentId != null ? await departmentLeafDepth(db, departmentId) : null

  return db.orgUnit.findMany({
    where: {
      path: { startsWith: unit.path },
      isActive: true,
      ...(depth != null ? { depth } : { isLeaf: true }),
    },
    orderBy: { name: 'asc' },
  })
}

/** Where a complaint goes when this unit misses its deadline. Null at the root. */
export async function parentOf(db: Db, unitId: number): Promise<OrgUnit | null> {
  const unit = await getUnit(db, unitId)
  if (!unit?.parentId) return null
  return getUnit(db, unit.parentId)
}

// ---------------------------------------------------------------------------
// Scope — what a person can see and act on
// ---------------------------------------------------------------------------

/**
 * Every unit a person's postings cover.
 *
 * Returns null for someone posted at the root, meaning "no limit" — callers
 * should skip unit filtering entirely rather than materialise the whole city.
 */
export async function unitsInScope(db: Db, userId: number): Promise<number[] | null> {
  const postings = await db.posting.findMany({
    where: { userId, endedAt: null, orgUnitId: { not: null } },
    select: { orgUnitId: true },
  })
  if (postings.length === 0) return []

  const unitIds = postings.map((p) => p.orgUnitId!).filter(Boolean)
  const units = await db.orgUnit.findMany({ where: { id: { in: unitIds } } })
  if (units.some((u) => u.depth === 0)) return null

  const covered = await db.orgUnit.findMany({
    where: { OR: units.map((u) => ({ path: { startsWith: u.path } })) },
    select: { id: true },
  })
  return [...new Set(covered.map((c) => c.id))]
}

/** Can this person act on something sitting at `unitId`? */
export async function hasScope(db: Db, userId: number, unitId: number | null): Promise<boolean> {
  const scope = await unitsInScope(db, userId)
  if (scope === null) return true
  if (unitId == null) return false
  return scope.includes(unitId)
}

// ---------------------------------------------------------------------------
// Layer behaviour — configured per department by the super admin
// ---------------------------------------------------------------------------

export const layersFor = (db: Db, departmentId: number) =>
  db.departmentLayer.findMany({ where: { departmentId }, orderBy: { depth: 'asc' } })

export const layerAt = (db: Db, departmentId: number, depth: number) =>
  db.departmentLayer.findUnique({ where: { departmentId_depth: { departmentId, depth } } })

/**
 * The deepest layer a department operates at — that department's own leaf.
 *
 * Not the same as the tree's leaves. The spine is shared, so a department that
 * runs two layers on a three-level tree stops at depth 1; depth-1 units have
 * children, but for *that* department they are the ground floor.
 */
export async function departmentLeafDepth(
  db: Db,
  departmentId: number,
): Promise<number | null> {
  const deepest = await db.departmentLayer.findFirst({
    where: { departmentId },
    orderBy: { depth: 'desc' },
  })
  return deepest?.depth ?? null
}

/**
 * Is this unit the ground floor for this department — the layer nearest the
 * citizen that the department actually staffs?
 */
export async function isDepartmentLeaf(
  db: Db,
  params: { unitId: number; departmentId: number },
): Promise<boolean> {
  const unit = await getUnit(db, params.unitId)
  if (!unit) return false
  const leafDepth = await departmentLeafDepth(db, params.departmentId)
  return leafDepth != null && unit.depth === leafDepth
}

/**
 * May work be dispatched to a crew member from this unit, for this department?
 *
 * Two conditions, both required: the unit is the department's ground floor, and
 * that layer is configured to dispatch. Deliberately keyed to the DEPARTMENT's
 * deepest layer rather than the tree's leaves — the spine is shared, so a
 * department running fewer layers would otherwise be unable to dispatch
 * anywhere at all.
 *
 * What the rule preserves either way: work is only ever dispatched from the
 * layer closest to the ground, never from a parent that would be skipping the
 * officer who actually knows the street.
 */
export async function canDispatchFrom(
  db: Db,
  params: { unitId: number; departmentId: number },
): Promise<boolean> {
  const unit = await getUnit(db, params.unitId)
  if (!unit?.isActive) return false

  const layer = await layerAt(db, params.departmentId, unit.depth)
  if (!layer?.canDispatch) return false

  return isDepartmentLeaf(db, params)
}

/** Hours a complaint may sit at this unit before escalating to the parent. */
export async function slaHoursFor(
  db: Db,
  params: { unitId: number; departmentId: number },
): Promise<number | null> {
  const unit = await getUnit(db, params.unitId)
  if (!unit) return null
  const layer = await layerAt(db, params.departmentId, unit.depth)
  return layer?.slaHours ?? null
}

// ---------------------------------------------------------------------------
// The six facets — identical at every depth
// ---------------------------------------------------------------------------

/** Officers posted directly at this unit (not its children). */
export function rosterAt(db: Db, unitId: number, departmentId?: number) {
  return db.posting.findMany({
    where: {
      orgUnitId: unitId,
      endedAt: null,
      user: { isActive: true },
      ...(departmentId ? { departmentId } : {}),
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true } },
      department: { select: { id: true, code: true, name: true, icon: true } },
    },
    orderBy: { userId: 'asc' },
  })
}

export interface UnitRollup {
  unitId: number
  open: number
  overdue: number
  awaitingVerification: number
  resolvedLast30d: number
  crew: number
  officers: number
}

const OPEN_STATUSES = ['ROUTED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_VERIFICATION'] as const

/**
 * The numbers for a unit AND everything under it.
 *
 * Same shape whether it is a sector or the whole city, which is what lets one
 * component render any layer.
 */
export async function rollup(db: Db, unitId: number, departmentId?: number): Promise<UnitRollup> {
  const ids = await getSubtreeIds(db, unitId)
  const scope = { orgUnitId: { in: ids }, ...(departmentId ? { departmentId } : {}) }
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)

  const [open, overdue, awaiting, resolved, crew, officers] = await Promise.all([
    db.complaint.count({ where: { ...scope, status: { in: [...OPEN_STATUSES] } } }),
    db.complaint.count({
      where: { ...scope, status: { in: [...OPEN_STATUSES] }, slaDueAt: { lt: new Date() } },
    }),
    db.complaint.count({ where: { ...scope, status: 'AWAITING_VERIFICATION' } }),
    db.complaint.count({
      where: { ...scope, status: { in: ['RESOLVED', 'CLOSED'] }, updatedAt: { gte: thirtyDaysAgo } },
    }),
    db.crew.count({
      where: { orgUnitId: { in: ids }, isActive: true, ...(departmentId ? { departmentId } : {}) },
    }),
    db.posting.count({
      where: {
        orgUnitId: { in: ids },
        endedAt: null,
        user: { isActive: true },
        ...(departmentId ? { departmentId } : {}),
      },
    }),
  ])

  return {
    unitId,
    open,
    overdue,
    awaitingVerification: awaiting,
    resolvedLast30d: resolved,
    crew,
    officers,
  }
}

/** Children with their rollups — the drill-down table every layer renders. */
export async function childrenWithRollups(db: Db, unitId: number, departmentId?: number) {
  const children = await getChildren(db, unitId)
  return Promise.all(
    children.map(async (child) => ({
      unit: child,
      stats: await rollup(db, child.id, departmentId),
    })),
  )
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface OfficerMatch {
  userId: number
  fullName: string
  designationTitle: string | null
  unitId: number
  openLoad: number
}

/**
 * The officer who should own a complaint sitting at a unit.
 *
 * Walks UP from the unit until it finds someone posted in this department, so a
 * vacancy at the leaf falls through to the layer above rather than stranding
 * the complaint. Least-loaded wins; ties break on id, which keeps routing
 * reproducible for the paper.
 */
export async function findOwnerFor(
  db: Db,
  params: { unitId: number; departmentId: number },
): Promise<OfficerMatch | null> {
  const unit = await getUnit(db, params.unitId)
  if (!unit) return null

  const chain = [unit, ...(await getAncestors(db, unit))].sort((a, b) => b.depth - a.depth)

  for (const candidate of chain) {
    const postings = await db.posting.findMany({
      where: {
        orgUnitId: candidate.id,
        departmentId: params.departmentId,
        endedAt: null,
        user: { isActive: true },
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            _count: {
              select: { ownedComplaints: { where: { status: { in: [...OPEN_STATUSES] } } } },
            },
          },
        },
      },
      orderBy: { userId: 'asc' },
    })
    if (postings.length === 0) continue

    const best = postings.reduce((a, b) =>
      b.user._count.ownedComplaints < a.user._count.ownedComplaints ? b : a,
    )
    return {
      userId: best.user.id,
      fullName: best.user.fullName,
      designationTitle: best.designationTitle,
      unitId: candidate.id,
      openLoad: best.user._count.ownedComplaints,
    }
  }
  return null
}

/**
 * Resolve a posting's target to a unit on the tree.
 *
 * A posting written without an `orgUnitId` routes nothing, appears in nobody's
 * scope and cannot be escalated to — it looks like an appointment and behaves
 * like a vacancy. Every writer of a posting must come through here.
 *
 * The zone/circle/sector trio is accepted only so older callers keep working.
 * Circles were dissolved when the tree was built, so a circle resolves to the
 * zone that contained it.
 */
export async function resolveUnitForPosting(
  db: Db,
  input: {
    orgUnitId?: number | null
    zoneId?: number | null
    circleId?: number | null
    sectorId?: number | null
  },
): Promise<number | null> {
  if (input.orgUnitId) {
    const unit = await db.orgUnit.findUnique({ where: { id: input.orgUnitId } })
    return unit?.isActive ? unit.id : null
  }

  let code: string | null = null
  if (input.sectorId) {
    const sector = await db.sector.findUnique({ where: { id: input.sectorId } })
    code = sector ? `SEC-${sector.number}` : null
  } else if (input.circleId) {
    const circle = await db.circle.findUnique({
      where: { id: input.circleId },
      include: { zone: true },
    })
    code = circle?.zone.code ?? null
  } else if (input.zoneId) {
    const zone = await db.zone.findUnique({ where: { id: input.zoneId } })
    code = zone?.code ?? null
  } else {
    // Authority-wide: the root.
    const root = await db.orgUnit.findFirst({ where: { parentId: null } })
    return root?.id ?? null
  }

  if (!code) return null
  const unit = await db.orgUnit.findUnique({ where: { code } })
  return unit?.id ?? null
}

// ---------------------------------------------------------------------------
// Mutation — what the super admin's panel calls
// ---------------------------------------------------------------------------

/** Add a unit under a parent, maintaining depth, path and the parent's leaf flag. */
export async function createUnit(
  db: Db,
  input: { parentId: number; code: string; name: string; nameHi?: string; kindLabel?: string },
) {
  const parent = await db.orgUnit.findUniqueOrThrow({ where: { id: input.parentId } })

  const created = await db.orgUnit.create({
    data: {
      code: input.code,
      name: input.name,
      nameHi: input.nameHi,
      parentId: parent.id,
      depth: parent.depth + 1,
      path: 'pending',
      kindLabel: input.kindLabel ?? `Level ${parent.depth + 1}`,
      isLeaf: true,
    },
  })

  const unit = await db.orgUnit.update({
    where: { id: created.id },
    data: { path: `${parent.path}${created.id}/` },
  })

  if (parent.isLeaf) {
    await db.orgUnit.update({ where: { id: parent.id }, data: { isLeaf: false } })
  }
  return unit
}

/**
 * Whether a unit can be removed.
 *
 * Refuses while anything still points at it, because a deleted unit with live
 * complaints is exactly how work disappears silently.
 */
export async function describeRemoval(db: Db, unitId: number) {
  const [children, complaints, postings, crew] = await Promise.all([
    db.orgUnit.count({ where: { parentId: unitId } }),
    db.complaint.count({ where: { orgUnitId: unitId } }),
    db.posting.count({ where: { orgUnitId: unitId, endedAt: null } }),
    db.crew.count({ where: { orgUnitId: unitId, isActive: true } }),
  ])
  const blockers: string[] = []
  if (children) blockers.push(`${children} child unit${children === 1 ? '' : 's'}`)
  if (complaints) blockers.push(`${complaints} complaint${complaints === 1 ? '' : 's'}`)
  if (postings) blockers.push(`${postings} posting${postings === 1 ? '' : 's'}`)
  if (crew) blockers.push(`${crew} crew member${crew === 1 ? '' : 's'}`)
  return { canRemove: blockers.length === 0, blockers }
}
