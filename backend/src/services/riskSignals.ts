/**
 * Collects GRIE's raw signals from live system data, and persists the resulting
 * scores and review flags.
 *
 * This is the bridge between the two engines: GCCE's routing decisions and the
 * escalations that follow become the history GRIE reads here. Signal
 * *definitions* live in this file; the maths that turns them into a score lives
 * in grie.ts, so the scoring model stays testable without a database.
 */
import { Prisma, RiskBand, RiskEntityType } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import * as audit from './audit.js'
import { DISCOUNTED_STATUSES, OPEN_STATUSES } from './gcce.js'
import {
  REVIEW_THRESHOLD,
  scoreEntity,
  type ScorableEntityType,
  type ScoreResult,
  type Signals,
} from './grie.js'
import * as org from './orgTree.js'

const log = createLogger('grie')

const DAY_MS = 86_400_000

/**
 * Complaint-derived signals for any geographic scope.
 *
 * Sector, circle and zone are scored on the same four measures — a circle is
 * just a wider net over the same complaints — so the query is written once and
 * the caller supplies the filter.
 */
async function complaintSignals(where: Prisma.ComplaintWhereInput): Promise<Signals> {
  const complaints = await prisma.complaint.findMany({
    where,
    select: {
      id: true,
      categoryId: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      slaDueAt: true,
      duplicateOfId: true,
      escalationLevel: true,
    },
  })

  const counted = complaints.filter((c) => !DISCOUNTED_STATUSES.includes(c.status))
  if (counted.length === 0) {
    return {
      repeatComplaintRate: 0,
      slaBreachRate: 0,
      openComplaintLoad: 0,
      avgResolutionDays: 0,
      escalationRate: 0,
    }
  }

  const openCount = counted.filter((c) => OPEN_STATUSES.includes(c.status)).length

  // A "repeat" is an issue this area already *fixed* and is now seeing again.
  //
  // The obvious definition — any complaint in a category the area has seen
  // before — measures volume, not repetition. It reduces to
  // 1 - (distinct categories / n), and since the category catalogue is fixed and
  // small, it climbs towards 1.0 for any busy area whether or not anything
  // actually recurred. `openComplaintLoad` already measures volume; this factor
  // was silently doing it a second time.
  //
  // What matters to an officer is narrower: something was reported, closed out,
  // and came back. That is the repair not holding, and it is the case worth
  // escalating. Ten potholes reported in one week are one wave and not repeats;
  // one pothole reported, fixed and reported again is a repeat.
  //
  // So a complaint counts if an earlier complaint in the same category here was
  // already resolved when it was filed. Complaints explicitly marked duplicate
  // are excluded rather than added: two people reporting the same pothole on the
  // same day is corroboration, not recurrence.
  const resolvedByCategory = new Map<number, number[]>()
  for (const c of counted) {
    if (c.categoryId == null || c.resolvedAt == null) continue
    const at = c.resolvedAt.getTime()
    const seen = resolvedByCategory.get(c.categoryId)
    if (seen) seen.push(at)
    else resolvedByCategory.set(c.categoryId, [at])
  }

  const candidates = counted.filter((c) => c.categoryId != null && c.duplicateOfId == null)
  const repeats = candidates.filter((c) => {
    const earlier = resolvedByCategory.get(c.categoryId!)
    if (!earlier) return false
    const filedAt = c.createdAt.getTime()
    // Strictly earlier: a complaint cannot be a repeat of itself.
    return earlier.some((resolvedAt) => resolvedAt < filedAt)
  }).length

  const repeatComplaintRate = candidates.length > 0 ? repeats / candidates.length : 0

  // An SLA breach is either a resolved complaint that finished late, or an open
  // one already past its deadline. Only complaints that *have* a deadline count
  // towards the denominator — an unrouted complaint has no promise to break.
  const withDeadline = counted.filter((c) => c.slaDueAt != null)
  const now = Date.now()
  const breached = withDeadline.filter((c) => {
    const due = c.slaDueAt!.getTime()
    return c.resolvedAt ? c.resolvedAt.getTime() > due : now > due
  }).length
  const slaBreachRate = withDeadline.length > 0 ? breached / withDeadline.length : 0

  const resolved = counted.filter((c) => c.resolvedAt != null)
  const avgResolutionDays =
    resolved.length > 0
      ? resolved.reduce((sum, c) => sum + (c.resolvedAt!.getTime() - c.createdAt.getTime()), 0) /
        resolved.length /
        DAY_MS
      : 0

  // Escalations are the strongest available evidence that the chain of command
  // is not working here: someone senior had to be pulled in.
  const escalationRate = counted.filter((c) => c.escalationLevel > 0).length / counted.length

  return {
    repeatComplaintRate,
    slaBreachRate,
    openComplaintLoad: openCount,
    avgResolutionDays,
    escalationRate,
  }
}

/**
 * Signals for a unit of the org tree, at any depth.
 *
 * Covers the unit and everything beneath it, so scoring a zone means scoring
 * the sectors inside it — which is what an officer looking at a zone is asking
 * about. One collector replaced the three that existed per tier.
 */
export const collectUnitSignals = async (unitId: number): Promise<Signals> =>
  complaintSignals({ orgUnitId: { in: await org.getSubtreeIds(prisma, unitId) } })

/**
 * The open-complaint count that reads as "completely saturated" here.
 *
 * A single sector is in serious trouble at 25 open complaints — the same
 * threshold GCCE uses to start escalating new arrivals. A zone aggregating six
 * sectors would hit 25 on a quiet day, so the cap scales with how many
 * ground-floor units sit beneath: the factor stays meaningful at every depth
 * instead of being inert at the top and hair-trigger at the bottom.
 */
export const SECTOR_SATURATION = 25

export async function unitLoadCap(unitId: number): Promise<number> {
  const leaves = await prisma.orgUnit.count({
    where: {
      path: { startsWith: (await prisma.orgUnit.findUnique({ where: { id: unitId } }))?.path ?? '' },
      isLeaf: true,
      isActive: true,
    },
  })
  return SECTOR_SATURATION * Math.max(1, leaves)
}

export const collectDepartmentSignals = (departmentId: number): Promise<Signals> =>
  complaintSignals({ departmentId })

export async function collectSignals(
  entityType: ScorableEntityType,
  entityId: number,
): Promise<Signals> {
  switch (entityType) {
    case RiskEntityType.ORG_UNIT:
      return collectUnitSignals(entityId)
    // Historical rows only; the three tiers are one tree now.
    case RiskEntityType.SECTOR:
    case RiskEntityType.CIRCLE:
    case RiskEntityType.ZONE:
      return collectUnitSignals(entityId)
    case RiskEntityType.DEPARTMENT:
      return collectDepartmentSignals(entityId)
  }
}

async function labelFor(entityType: ScorableEntityType, entityId: number): Promise<string> {
  switch (entityType) {
    case RiskEntityType.ORG_UNIT:
    case RiskEntityType.SECTOR:
    case RiskEntityType.CIRCLE:
    case RiskEntityType.ZONE: {
      const unit = await prisma.orgUnit.findUnique({ where: { id: entityId } })
      // Named by its own layer, so the queue reads "Zone III" or "Sector 5"
      // without the reader needing to know how deep the authority runs.
      return unit ? `${unit.kindLabel} ${unit.name}` : `Unit #${entityId}`
    }
    case RiskEntityType.DEPARTMENT: {
      const d = await prisma.department.findUnique({ where: { id: entityId } })
      return d ? d.name : `Department #${entityId}`
    }
  }
}

/**
 * Score one entity from live data, store the result, and raise a review flag if
 * it crossed the threshold.
 *
 * Scores are append-only so their history can be replayed. Flags are not: an
 * entity that is still risky updates its existing pending flag rather than
 * stacking a new one on the supervisor's queue every time anything changes.
 */
export async function recomputeEntity(
  entityType: ScorableEntityType,
  entityId: number,
): Promise<ScoreResult> {
  const signals = await collectSignals(entityType, entityId)
  // An area's saturation point depends on how much ground it covers, so a unit
  // supplies its own rather than being judged by a single sector's threshold.
  const loadCap =
    entityType === RiskEntityType.ORG_UNIT ? await unitLoadCap(entityId) : undefined
  const result = scoreEntity(entityType, entityId, signals, undefined, loadCap)

  const stored = await prisma.riskScore.create({
    data: {
      entityType,
      entityId,
      score: result.score,
      band: result.band,
      factors: result.factors as unknown as Prisma.InputJsonValue,
      modelVersion: result.modelVersion,
    },
  })

  const existingFlag = await prisma.riskFlag.findFirst({
    where: { entityType, entityId, status: 'PENDING' },
  })

  if (result.needsReview) {
    const label = await labelFor(entityType, entityId)
    if (existingFlag) {
      await prisma.riskFlag.update({
        where: { id: existingFlag.id },
        data: {
          riskScoreId: stored.id,
          score: result.score,
          band: result.band,
          reason: result.topReason,
          entityLabel: label,
        },
      })
    } else {
      await prisma.riskFlag.create({
        data: {
          riskScoreId: stored.id,
          entityType,
          entityId,
          entityLabel: label,
          score: result.score,
          band: result.band,
          reason: result.topReason,
        },
      })
      await prisma.$transaction((tx) =>
        audit.record(tx, {
          action: 'risk.flagged',
          entityType: entityType.toLowerCase(),
          entityId,
          payload: { score: result.score, band: result.band, reason: result.topReason },
          actorLabel: 'GRIE',
          source: 'grie',
        }),
      )
      log.info(`flagged ${entityType} ${entityId} at ${result.score} (${result.band})`)
    }
  } else if (existingFlag) {
    // The entity recovered. Close the flag rather than leaving a stale warning
    // in the supervisor's queue.
    await prisma.riskFlag.update({
      where: { id: existingFlag.id },
      data: {
        status: 'DISMISSED',
        reviewNote: `Automatically cleared — the score fell to ${result.score}, below the review threshold of ${REVIEW_THRESHOLD}.`,
        reviewedAt: new Date(),
      },
    })
    log.info(`cleared flag on ${entityType} ${entityId} (score now ${result.score})`)
  }

  return result
}

/** Latest stored score for an entity, or null if it has never been scored. */
export function latestScore(entityType: RiskEntityType, entityId: number) {
  return prisma.riskScore.findFirst({
    where: { entityType, entityId },
    orderBy: { computedAt: 'desc' },
  })
}

/**
 * Rescore everything.
 *
 * Units run deepest-first, because a parent aggregates its children.
 */
export async function recomputeAll(): Promise<Record<string, number>> {
  const [units, departments] = await Promise.all([
    prisma.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true, depth: true },
      orderBy: { depth: 'desc' },
    }),
    prisma.department.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
  ])

  for (const u of units) await recomputeEntity(RiskEntityType.ORG_UNIT, u.id)
  for (const d of departments) await recomputeEntity(RiskEntityType.DEPARTMENT, d.id)

  const counts = {
    units: units.length,
    departments: departments.length,
  }
  log.info('recomputed', counts)
  return counts
}

/**
 * Rescore a unit and every layer above it, without blocking the request that
 * triggered it.
 *
 * The whole chain is rescored because a complaint in one sector changes the
 * picture for the zone and the city too — that is what a rollup means. Walking
 * the tree replaces the fixed sector/circle/zone sequence, so it keeps working
 * at whatever depth the authority is configured to.
 *
 * A citizen filing a complaint should not wait on risk analysis, and a scoring
 * failure must never fail their submission.
 */
export function scheduleUnitRescore(unitId: number): void {
  setImmediate(() => {
    void (async () => {
      try {
        const unit = await prisma.orgUnit.findUnique({ where: { id: unitId } })
        if (!unit) return

        const chain = [unit.id, ...(await org.getAncestors(prisma, unit)).map((a) => a.id)]
        for (const id of chain) {
          await recomputeEntity(RiskEntityType.ORG_UNIT, id)
        }
      } catch (err) {
        log.error(`background rescore of unit ${unitId} failed`, err)
      }
    })()
  })
}

export const RISK_BAND_ORDER: Record<RiskBand, number> = {
  [RiskBand.SEVERE]: 0,
  [RiskBand.HIGH]: 1,
  [RiskBand.MODERATE]: 2,
  [RiskBand.LOW]: 3,
}
