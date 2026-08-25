/**
 * Collects GRIE's raw signals from live system data, and persists the resulting
 * scores and review flags.
 *
 * This is the bridge between the two engines: GCCE's routing decisions become
 * the complaint history that GRIE reads here. Signal *definitions* live in this
 * file; the maths that turns them into a score lives in grie.ts, so the scoring
 * model stays testable without a database.
 */
import { ComplaintStatus, Prisma, RiskBand, RiskEntityType } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import * as audit from './audit.js'
import { REVIEW_THRESHOLD, scoreEntity, type ScoreResult, type Signals } from './grie.js'

const log = createLogger('grie')

const DAY_MS = 24 * 60 * 60 * 1000

/** Statuses that mean the complaint is still someone's problem. */
const OPEN_STATUSES: ComplaintStatus[] = [
  ComplaintStatus.SUBMITTED,
  ComplaintStatus.ROUTED,
  ComplaintStatus.ASSIGNED,
  ComplaintStatus.IN_PROGRESS,
]

/** Statuses that do not represent real work — excluded from every rate. */
const DISCOUNTED: ComplaintStatus[] = [ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE]

export async function collectWardSignals(wardId: number): Promise<Signals> {
  const complaints = await prisma.complaint.findMany({
    where: { wardId },
    select: {
      id: true,
      categoryId: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      slaDueAt: true,
      duplicateOfId: true,
    },
  })

  const counted = complaints.filter((c) => !DISCOUNTED.includes(c.status))
  if (counted.length === 0) {
    return {
      repeatComplaintRate: 0,
      slaBreachRate: 0,
      openComplaintLoad: 0,
      avgResolutionDays: 0,
    }
  }

  const openCount = counted.filter((c) => OPEN_STATUSES.includes(c.status)).length

  // A "repeat" is a complaint in a category this ward has already seen. The
  // first complaint of a category is not a repeat, so the count is
  // (occurrences - 1) per category, plus anything explicitly marked duplicate.
  const perCategory = new Map<number, number>()
  for (const c of counted) {
    if (c.categoryId == null) continue
    perCategory.set(c.categoryId, (perCategory.get(c.categoryId) ?? 0) + 1)
  }
  let repeats = 0
  for (const count of perCategory.values()) repeats += Math.max(0, count - 1)
  const explicitDuplicates = complaints.filter((c) => c.duplicateOfId != null).length
  const repeatComplaintRate = Math.min(1, (repeats + explicitDuplicates) / counted.length)

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

  return {
    repeatComplaintRate,
    slaBreachRate,
    openComplaintLoad: openCount,
    avgResolutionDays,
  }
}

export async function collectProjectSignals(projectId: number): Promise<Signals> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { inspections: true },
  })
  if (!project) return {}

  const allocated = project.budgetAllocated ? Number(project.budgetAllocated) : 0
  const spent = project.budgetSpent ? Number(project.budgetSpent) : 0
  const budgetOverrun = allocated > 0 ? Math.max(0, (spent - allocated) / allocated) : 0

  // A finished project's delay is fixed; an unfinished one keeps accruing.
  const end = project.actualEnd ?? new Date()
  const scheduleDelayDays = project.plannedEnd
    ? Math.max(0, (end.getTime() - project.plannedEnd.getTime()) / DAY_MS)
    : 0

  const conducted = project.inspections.filter((i) => i.passed != null)
  const inspectionFailureRate =
    conducted.length > 0 ? conducted.filter((i) => i.passed === false).length / conducted.length : 0

  const linkedComplaints = project.wardId
    ? await prisma.complaint.count({
        where: { wardId: project.wardId, status: { notIn: DISCOUNTED } },
      })
    : 0

  return { budgetOverrun, scheduleDelayDays, inspectionFailureRate, linkedComplaints }
}

export async function collectContractorSignals(contractorId: number): Promise<Signals> {
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    include: { projects: { include: { inspections: true } } },
  })
  if (!contractor) return {}

  const projects = contractor.projects

  // Averaging the contractor's own projects is why project scoring has to run
  // before contractor scoring in `recomputeAll`.
  let avgProjectRisk = 0
  if (projects.length > 0) {
    const scores = await Promise.all(
      projects.map(async (p) => {
        const signals = await collectProjectSignals(p.id)
        return scoreEntity(RiskEntityType.PROJECT, p.id, signals).score
      }),
    )
    avgProjectRisk = scores.reduce((a, b) => a + b, 0) / scores.length
  }

  const finished = projects.filter((p) => p.actualEnd != null && p.plannedEnd != null)
  const lateDeliveryRate =
    finished.length > 0
      ? finished.filter((p) => p.actualEnd!.getTime() > p.plannedEnd!.getTime()).length /
        finished.length
      : 0

  const inspections = projects.flatMap((p) => p.inspections).filter((i) => i.passed != null)
  const inspectionFailureRate =
    inspections.length > 0
      ? inspections.filter((i) => i.passed === false).length / inspections.length
      : 0

  return {
    avgProjectRisk,
    lateDeliveryRate,
    inspectionFailureRate,
    isBlacklisted: contractor.isBlacklisted ? 1 : 0,
  }
}

export async function collectSignals(
  entityType: RiskEntityType,
  entityId: number,
): Promise<Signals> {
  switch (entityType) {
    case RiskEntityType.WARD:
      return collectWardSignals(entityId)
    case RiskEntityType.PROJECT:
      return collectProjectSignals(entityId)
    case RiskEntityType.CONTRACTOR:
      return collectContractorSignals(entityId)
  }
}

async function labelFor(entityType: RiskEntityType, entityId: number): Promise<string> {
  if (entityType === RiskEntityType.WARD) {
    const ward = await prisma.ward.findUnique({ where: { id: entityId } })
    return ward ? `Ward ${ward.wardNumber} — ${ward.name}` : `Ward #${entityId}`
  }
  if (entityType === RiskEntityType.PROJECT) {
    const project = await prisma.project.findUnique({ where: { id: entityId } })
    return project ? project.name : `Project #${entityId}`
  }
  const contractor = await prisma.contractor.findUnique({ where: { id: entityId } })
  return contractor ? contractor.name : `Contractor #${entityId}`
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
  entityType: RiskEntityType,
  entityId: number,
): Promise<ScoreResult> {
  const signals = await collectSignals(entityType, entityId)
  const result = scoreEntity(entityType, entityId, signals)

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
export async function latestScore(entityType: RiskEntityType, entityId: number) {
  return prisma.riskScore.findFirst({
    where: { entityType, entityId },
    orderBy: { computedAt: 'desc' },
  })
}

/**
 * Rescore everything. Projects run before contractors because a contractor's
 * dominant factor is the average risk of its own projects.
 */
export async function recomputeAll(): Promise<{ wards: number; projects: number; contractors: number }> {
  const [wards, projects, contractors] = await Promise.all([
    prisma.ward.findMany({ select: { id: true } }),
    prisma.project.findMany({ select: { id: true } }),
    prisma.contractor.findMany({ select: { id: true } }),
  ])

  for (const w of wards) await recomputeEntity(RiskEntityType.WARD, w.id)
  for (const p of projects) await recomputeEntity(RiskEntityType.PROJECT, p.id)
  for (const c of contractors) await recomputeEntity(RiskEntityType.CONTRACTOR, c.id)

  log.info(
    `recomputed ${wards.length} wards, ${projects.length} projects, ${contractors.length} contractors`,
  )
  return { wards: wards.length, projects: projects.length, contractors: contractors.length }
}

/**
 * Rescore a ward without blocking the request that triggered it.
 *
 * GCCE calls this after routing. A citizen filing a complaint should not wait on
 * risk analysis, and a scoring failure must never fail their submission.
 */
export function scheduleWardRescore(wardId: number): void {
  setImmediate(() => {
    recomputeEntity(RiskEntityType.WARD, wardId).catch((err) =>
      log.error(`background rescore of ward ${wardId} failed`, err),
    )
  })
}

export const RISK_BAND_ORDER: Record<RiskBand, number> = {
  [RiskBand.SEVERE]: 0,
  [RiskBand.HIGH]: 1,
  [RiskBand.MODERATE]: 2,
  [RiskBand.LOW]: 3,
}
