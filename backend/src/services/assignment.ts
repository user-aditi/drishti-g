/**
 * Who answers for a request — Layer 1's one rule, and the only place it lives.
 *
 * NYC 311 holds an *agency* accountable and never a person, and records no
 * case-worker identity at all (F-12). Layer 1 is the claim that naming one
 * person per open request is worth having. It is measured by whether it holds —
 * every open request has exactly one accountable, currently-posted officer — and
 * by how quickly this system makes the assignment. It is not measured by any
 * change in resolution time, because there is no real officer behaviour to
 * replay, and a simulated one would be invented data.
 *
 * The posting rule: the officer posted to the request's agency and board, and
 * among several, the one holding the fewest open requests, ties to the lower id
 * so the choice is reproducible. A request with no board — 180 open ones, 170 of
 * them DOT's — goes to the agency's duty officer for the borough, so it is not
 * left belonging to nobody for want of a map coordinate.
 */
import {
  AssignmentSource,
  RequestStatus,
  Role,
  type Prisma,
  type PrismaClient,
  type ServiceRequest,
} from '@prisma/client'
import * as audit from './audit.js'

type Db = PrismaClient | Prisma.TransactionClient

/** Active officers posted to exactly this agency and unit. */
async function postedOfficers(db: Db, agencyId: number, orgUnitId: number): Promise<number[]> {
  const postings = await db.posting.findMany({
    where: { agencyId, orgUnitId, endedAt: null, user: { role: Role.OFFICER, isActive: true } },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  })
  return postings.map((p) => p.userId)
}

/** The borough a board sits in, or the root when the request has no board. */
async function boroughOf(db: Db, orgUnitId: number | null): Promise<number | null> {
  if (orgUnitId !== null) {
    const board = await db.orgUnit.findUnique({ where: { id: orgUnitId }, select: { parentId: true } })
    if (board?.parentId) return board.parentId
  }
  // One borough in this slice. With more, an unplaceable request would need a
  // borough of its own to fall back to, and NYC does publish one per request.
  const root = await db.orgUnit.findFirst({ where: { depth: 0 }, select: { id: true } })
  return root?.id ?? null
}

/** The officer the posting rule picks, or null when nobody is posted. */
export async function officerFor(
  db: Db,
  agencyId: number,
  orgUnitId: number | null,
): Promise<number | null> {
  let pool = orgUnitId === null ? [] : await postedOfficers(db, agencyId, orgUnitId)
  if (pool.length === 0) {
    const borough = await boroughOf(db, orgUnitId)
    if (borough !== null) pool = await postedOfficers(db, agencyId, borough)
  }
  if (pool.length === 0) return null
  if (pool.length === 1) return pool[0]!

  const loads = await db.serviceRequest.groupBy({
    by: ['assignedOfficerId'],
    where: { assignedOfficerId: { in: pool }, status: { not: RequestStatus.CLOSED } },
    _count: { _all: true },
  })
  const load = new Map(loads.map((l) => [l.assignedOfficerId!, l._count._all]))
  return pool.reduce(
    (best, id) => ((load.get(id) ?? 0) < (load.get(best) ?? 0) ? id : best),
    pool[0]!,
  )
}

/**
 * Whether a supervisor may hand this request to this officer: same agency, and
 * posted either to the request's board or to the borough.
 */
export async function isEligible(
  db: Db,
  officerId: number,
  request: Pick<ServiceRequest, 'agencyId' | 'orgUnitId'>,
): Promise<boolean> {
  const borough = await boroughOf(db, request.orgUnitId)
  const units = [request.orgUnitId, borough].filter((id): id is number => id !== null)
  const posting = await db.posting.findFirst({
    where: {
      userId: officerId,
      agencyId: request.agencyId,
      orgUnitId: { in: units },
      endedAt: null,
      user: { role: Role.OFFICER, isActive: true },
    },
    select: { id: true },
  })
  return posting !== null
}

export interface AssignInput {
  requestId: number
  officerId: number
  /** Null when the posting rule decided rather than a person. */
  byUserId: number | null
  byLabel: string
  source: AssignmentSource
  at?: Date
}

/**
 * Make the assignment, log it, and put it on the chain — in the caller's
 * transaction, so the three cannot disagree.
 *
 * No status-history row is written. An assignment is not a status change, and
 * that table feeds the process-mining event log; putting our assignments in it
 * would make NYC's lifecycle look like it had steps it never had.
 */
export async function assign(tx: Prisma.TransactionClient, input: AssignInput): Promise<void> {
  const at = input.at ?? new Date()
  const officer = await tx.user.findUniqueOrThrow({
    where: { id: input.officerId },
    select: { name: true },
  })

  await tx.serviceRequest.update({
    where: { id: input.requestId },
    data: { assignedOfficerId: input.officerId, assignedAt: at },
  })
  await tx.assignment.create({
    data: {
      requestId: input.requestId,
      officerId: input.officerId,
      assignedById: input.byUserId,
      source: input.source,
      at,
    },
  })
  await audit.record(tx, {
    action: 'request.assigned',
    entityType: 'request',
    entityId: input.requestId,
    payload: { officerId: input.officerId, officer: officer.name, source: input.source },
    actorId: input.byUserId,
    actorLabel: input.byLabel,
    source: input.byUserId === null ? 'system' : 'api',
  })
}

/**
 * The filing hook: a new request leaves the filing transaction already owned.
 *
 * If nobody is posted it stays unassigned rather than failing the filing — a
 * citizen's report must never be refused because of a gap in our staffing — and
 * it surfaces in the supervisor's unassigned queue and in the coverage figure,
 * which is exactly where a gap like that should be visible.
 */
export async function assignOnFiling(
  tx: Prisma.TransactionClient,
  request: ServiceRequest,
): Promise<void> {
  const officerId = await officerFor(tx, request.agencyId, request.orgUnitId)
  if (officerId === null) return
  await assign(tx, {
    requestId: request.id,
    officerId,
    byUserId: null,
    byLabel: 'posting rule',
    source: AssignmentSource.POSTING_RULE,
  })
}
