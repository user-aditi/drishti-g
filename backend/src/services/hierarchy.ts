/**
 * The chain of command.
 *
 * Everything that needs to answer "who is responsible for this?" or "who does
 * this go to next?" comes through here, so the org chart lives in one place
 * rather than being re-implemented in every route.
 */
import { JurisdictionLevel, Rank } from '@prisma/client'
import type { Prisma, PrismaClient } from '@prisma/client'
import * as org from './orgTree.js'

export type Db = PrismaClient | Prisma.TransactionClient

/**
 * Numeric seniority. Must stay in step with the Rank enum in schema.prisma —
 * escalation and every permission check compare these numbers.
 */
export const RANK_LEVEL: Record<Rank, number> = {
  [Rank.CITIZEN]: 0,
  [Rank.FIELD_WORKER]: 1,
  [Rank.SECTION_OFFICER]: 2,
  [Rank.CIRCLE_OFFICER]: 3,
  [Rank.ZONAL_OFFICER]: 4,
  [Rank.HOD]: 5,
  [Rank.CEO]: 6,
  [Rank.SUPER_ADMIN]: 7,
}

/** Generic label for a rank, used when no department designation applies. */
export const RANK_LABEL: Record<Rank, string> = {
  [Rank.CITIZEN]: 'Citizen',
  [Rank.FIELD_WORKER]: 'Field Worker',
  [Rank.SECTION_OFFICER]: 'Section Officer',
  [Rank.CIRCLE_OFFICER]: 'Circle Officer',
  [Rank.ZONAL_OFFICER]: 'Zonal Officer',
  [Rank.HOD]: 'Head of Department',
  [Rank.CEO]: 'Chief Executive Officer',
  [Rank.SUPER_ADMIN]: 'System Administrator',
}

/** The jurisdiction a rank operates over. */
export const RANK_JURISDICTION: Record<Rank, JurisdictionLevel> = {
  [Rank.CITIZEN]: JurisdictionLevel.SECTOR,
  [Rank.FIELD_WORKER]: JurisdictionLevel.SECTOR,
  [Rank.SECTION_OFFICER]: JurisdictionLevel.SECTOR,
  [Rank.CIRCLE_OFFICER]: JurisdictionLevel.CIRCLE,
  [Rank.ZONAL_OFFICER]: JurisdictionLevel.ZONE,
  [Rank.HOD]: JurisdictionLevel.AUTHORITY,
  [Rank.CEO]: JurisdictionLevel.AUTHORITY,
  [Rank.SUPER_ADMIN]: JurisdictionLevel.AUTHORITY,
}

/**
 * The escalation ladder for a complaint.
 *
 * Stops at HOD. A general manager is where a stuck pothole should realistically
 * end up; routing routine complaints to the CEO would make the CEO's queue
 * meaningless, which is exactly how escalation dies in practice.
 */
export const ESCALATION_LADDER: Rank[] = [
  Rank.SECTION_OFFICER,
  Rank.CIRCLE_OFFICER,
  Rank.ZONAL_OFFICER,
  Rank.HOD,
]

export function nextRankUp(rank: Rank): Rank | null {
  const index = ESCALATION_LADDER.indexOf(rank)
  if (index === -1 || index === ESCALATION_LADDER.length - 1) return null
  return ESCALATION_LADDER[index + 1]!
}

export const isAtLeast = (rank: Rank, floor: Rank): boolean =>
  RANK_LEVEL[rank] >= RANK_LEVEL[floor]

/** Ranks that manage other people rather than doing the physical work. */
export const isOfficer = (rank: Rank): boolean =>
  RANK_LEVEL[rank] >= RANK_LEVEL[Rank.SECTION_OFFICER]

/** Ranks that see across departments rather than sitting inside one. */
export const isAuthorityWide = (rank: Rank): boolean =>
  rank === Rank.CEO || rank === Rank.SUPER_ADMIN

// ---------------------------------------------------------------------------
// Jurisdiction
//
// These now delegate to the org tree. They keep their old signatures so every
// caller stays put, but the answers come from `orgTree` — there is one source
// of truth for "who is responsible for what", and it is the tree.
//
// The legacy sector-shaped arguments are still accepted because complaints
// carry both columns during the migration; whichever is supplied, the check is
// performed against the tree.
// ---------------------------------------------------------------------------

/** Map a legacy sector id to its unit, or null if it has none. */
async function unitForSector(db: Db, sectorId: number): Promise<number | null> {
  const sector = await db.sector.findUnique({ where: { id: sectorId } })
  if (!sector) return null
  const unit = await db.orgUnit.findUnique({ where: { code: `SEC-${sector.number}` } })
  return unit?.id ?? null
}

/**
 * Every sector a person's postings cover.
 *
 * Derived from the tree and then mapped back to legacy sector ids, so callers
 * still filtering complaints by `sectorId` get an answer consistent with
 * everything else. Null means "no geographic limit".
 */
export async function sectorsInScope(db: Db, userId: number): Promise<number[] | null> {
  const units = await org.unitsInScope(db, userId)
  if (units === null) return null
  if (units.length === 0) return []

  const rows = await db.orgUnit.findMany({
    where: { id: { in: units }, code: { startsWith: 'SEC-' } },
    select: { code: true },
  })
  const numbers = rows
    .map((r) => Number(r.code.slice(4)))
    .filter((n) => Number.isFinite(n))
  if (numbers.length === 0) return []

  const sectors = await db.sector.findMany({
    where: { number: { in: numbers } },
    select: { id: true },
  })
  return sectors.map((s) => s.id)
}

/**
 * Departments a person's postings cover; null means all of them.
 *
 * A posting with no department is the cross-departmental one — the CEO and the
 * Super Admin. Sitting at the top of the tree is NOT the same thing: a General
 * Manager runs one department across the whole city and has no business reading
 * another department's complaints.
 */
export async function departmentsInScope(db: Db, userId: number): Promise<number[] | null> {
  const postings = await db.posting.findMany({
    where: { userId, endedAt: null },
    select: { departmentId: true },
  })
  if (postings.length === 0) return []
  if (postings.some((p) => p.departmentId == null)) return null
  return [...new Set(postings.map((p) => p.departmentId!))]
}

/**
 * Can `actor` act on something in this department and place?
 *
 * Enforced server-side on every write. Seniority alone is never enough — an
 * officer in one zone has no business acting in another, however senior.
 */
export async function hasJurisdiction(
  db: Db,
  actor: { id: number; rank: Rank },
  target: { departmentId: number | null; sectorId?: number | null; orgUnitId?: number | null },
): Promise<boolean> {
  const departments = await departmentsInScope(db, actor.id)
  if (departments !== null) {
    if (target.departmentId == null) return false
    if (!departments.includes(target.departmentId)) return false
  }

  const units = await org.unitsInScope(db, actor.id)
  if (units === null) return true

  const unitId =
    target.orgUnitId ?? (target.sectorId != null ? await unitForSector(db, target.sectorId) : null)
  if (unitId == null) return false

  return units.includes(unitId)
}

/** The designation title for a rank in a department, falling back to the generic one. */
export async function designationFor(
  db: Db,
  departmentId: number | null,
  rank: Rank,
): Promise<string> {
  if (departmentId == null) return RANK_LABEL[rank]
  const designation = await db.designation.findUnique({
    where: { departmentId_rank: { departmentId, rank } },
  })
  return designation?.title ?? RANK_LABEL[rank]
}
