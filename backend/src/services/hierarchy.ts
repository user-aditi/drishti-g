/**
 * The chain of command.
 *
 * Everything that needs to answer "who is responsible for this?" or "who does
 * this go to next?" comes through here, so the org chart lives in one place
 * rather than being re-implemented in every route.
 */
import { JurisdictionLevel, Rank } from '@prisma/client'
import type { Prisma, PrismaClient } from '@prisma/client'

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
// ---------------------------------------------------------------------------

export interface SectorContext {
  sectorId: number
  sectorNumber: number
  circleId: number
  zoneId: number
}

/** Resolve a sector to its circle and zone — the spine of every lookup here. */
export async function sectorContext(db: Db, sectorId: number): Promise<SectorContext | null> {
  const sector = await db.sector.findUnique({
    where: { id: sectorId },
    include: { circle: true },
  })
  if (!sector) return null
  return {
    sectorId: sector.id,
    sectorNumber: sector.number,
    circleId: sector.circleId,
    zoneId: sector.circle.zoneId,
  }
}

/**
 * Every sector a person's postings cover.
 *
 * An authority-wide posting returns null, meaning "no geographic limit" — the
 * caller should skip sector filtering entirely rather than build a list of the
 * whole city.
 */
export async function sectorsInScope(db: Db, userId: number): Promise<number[] | null> {
  const postings = await db.posting.findMany({
    where: { userId, endedAt: null },
  })
  if (postings.length === 0) return []
  if (postings.some((p) => p.level === JurisdictionLevel.AUTHORITY)) return null

  const zoneIds = postings.map((p) => p.zoneId).filter((v): v is number => v != null)
  const circleIds = postings.map((p) => p.circleId).filter((v): v is number => v != null)
  const sectorIds = postings.map((p) => p.sectorId).filter((v): v is number => v != null)

  const covered = await db.sector.findMany({
    where: {
      OR: [
        { id: { in: sectorIds } },
        { circleId: { in: circleIds } },
        { circle: { zoneId: { in: zoneIds } } },
      ],
    },
    select: { id: true },
  })

  return [...new Set(covered.map((s) => s.id))]
}

/** Departments a person's postings cover; null means all of them. */
export async function departmentsInScope(db: Db, userId: number): Promise<number[] | null> {
  const postings = await db.posting.findMany({
    where: { userId, endedAt: null },
    select: { departmentId: true, rank: true },
  })
  if (postings.some((p) => isAuthorityWide(p.rank))) return null
  const ids = postings.map((p) => p.departmentId).filter((v): v is number => v != null)
  return [...new Set(ids)]
}

// ---------------------------------------------------------------------------
// Finding the right person
// ---------------------------------------------------------------------------

export interface OfficerMatch {
  userId: number
  fullName: string
  rank: Rank
  designationTitle: string | null
  openLoad: number
}

/**
 * The officer of a given rank responsible for a sector in a department.
 *
 * Walks outward from the sector to the circle to the zone, because that is how
 * a rank's jurisdiction is stored: a Circle Officer is posted to a circle, not
 * to each of its sectors.
 *
 * When several people hold the post, the least-loaded one wins and ties break
 * on id — which is what keeps routing reproducible.
 */
export async function findResponsibleOfficer(
  db: Db,
  params: { departmentId: number; sectorId: number; rank: Rank },
): Promise<OfficerMatch | null> {
  const context = await sectorContext(db, params.sectorId)
  if (!context) return null

  const scope: Prisma.PostingWhereInput =
    params.rank === Rank.SECTION_OFFICER || params.rank === Rank.FIELD_WORKER
      ? { sectorId: context.sectorId }
      : params.rank === Rank.CIRCLE_OFFICER
        ? { circleId: context.circleId }
        : params.rank === Rank.ZONAL_OFFICER
          ? { zoneId: context.zoneId }
          : { level: JurisdictionLevel.AUTHORITY }

  const postings = await db.posting.findMany({
    where: {
      departmentId: params.departmentId,
      rank: params.rank,
      endedAt: null,
      user: { isActive: true },
      ...scope,
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          _count: {
            select: {
              ownedComplaints: {
                where: {
                  status: {
                    in: ['ROUTED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_VERIFICATION'],
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { userId: 'asc' },
  })

  if (postings.length === 0) return null

  const best = postings.reduce((a, b) =>
    b.user._count.ownedComplaints < a.user._count.ownedComplaints ? b : a,
  )

  return {
    userId: best.user.id,
    fullName: best.user.fullName,
    rank: best.rank,
    designationTitle: best.designationTitle,
    openLoad: best.user._count.ownedComplaints,
  }
}

export interface WorkerMatch {
  userId: number
  fullName: string
  trade: string | null
  designationTitle: string | null
  employeeCode: string | null
  activeJobs: number
}

/**
 * The field workers a Section Officer can put on a job.
 *
 * Scoped to the officer's own sector and department, optionally narrowed to the
 * trade the category calls for — a lineman is not sent to clear a drain.
 */
export async function workersForSector(
  db: Db,
  params: { departmentId: number; sectorId: number; trade?: string | null },
): Promise<WorkerMatch[]> {
  const postings = await db.posting.findMany({
    where: {
      departmentId: params.departmentId,
      sectorId: params.sectorId,
      rank: Rank.FIELD_WORKER,
      endedAt: null,
      user: { isActive: true },
      ...(params.trade ? { trade: params.trade as never } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          _count: {
            select: {
              workerComplaints: {
                where: { status: { in: ['IN_PROGRESS', 'AWAITING_VERIFICATION'] } },
              },
            },
          },
        },
      },
    },
    orderBy: { userId: 'asc' },
  })

  return postings
    .map((p) => ({
      userId: p.user.id,
      fullName: p.user.fullName,
      trade: p.trade,
      designationTitle: p.designationTitle,
      employeeCode: p.employeeCode,
      activeJobs: p.user._count.workerComplaints,
    }))
    .sort((a, b) => a.activeJobs - b.activeJobs || a.userId - b.userId)
}

/**
 * Can `actor` act on a complaint in this department and sector?
 *
 * Enforced server-side on every write. Seniority alone is not enough — an
 * Executive Engineer in Zone II has no business closing a complaint in Zone I.
 */
export async function hasJurisdiction(
  db: Db,
  actor: { id: number; rank: Rank },
  target: { departmentId: number | null; sectorId: number | null },
): Promise<boolean> {
  if (isAuthorityWide(actor.rank)) return true

  const departments = await departmentsInScope(db, actor.id)
  if (departments !== null) {
    if (target.departmentId == null) return false
    if (!departments.includes(target.departmentId)) return false
  }

  const sectors = await sectorsInScope(db, actor.id)
  if (sectors === null) return true
  if (target.sectorId == null) return false
  return sectors.includes(target.sectorId)
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
