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
import { REVIEW_THRESHOLD, scoreEntity, type ScoreResult, type Signals } from './grie.js'

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

  // A "repeat" is a complaint in a category this area has already seen. The
  // first of a category is not a repeat, so the count is (occurrences - 1) per
  // category, plus anything explicitly marked duplicate.
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

export const collectSectorSignals = (sectorId: number): Promise<Signals> =>
  complaintSignals({ sectorId })

export const collectCircleSignals = (circleId: number): Promise<Signals> =>
  complaintSignals({ sector: { circleId } })

export const collectZoneSignals = (zoneId: number): Promise<Signals> =>
  complaintSignals({ sector: { circle: { zoneId } } })

export const collectDepartmentSignals = (departmentId: number): Promise<Signals> =>
  complaintSignals({ departmentId })

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

  const linkedComplaints = project.sectorId
    ? await prisma.complaint.count({
        where: { sectorId: project.sectorId, status: { notIn: DISCOUNTED_STATUSES } },
      })
    : 0

  return { budgetOverrun, scheduleDelayDays, inspectionFailureRate, linkedComplaints }
}

export async function collectContractorSignals(contractorId: number): Promise<Signals> {
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    include: { projects: { select: { id: true, actualEnd: true, plannedEnd: true } } },
  })
  if (!contractor) return {}

  const projects = contractor.projects

  // Averaging the contractor's own projects is why project scoring runs before
  // contractor scoring in `recomputeAll`.
  let avgProjectRisk = 0
  if (projects.length > 0) {
    const scores = await Promise.all(
      projects.map(async (p) =>
        scoreEntity(RiskEntityType.PROJECT, p.id, await collectProjectSignals(p.id)).score,
      ),
    )
    avgProjectRisk = scores.reduce((a, b) => a + b, 0) / scores.length
  }

  const finished = projects.filter((p) => p.actualEnd != null && p.plannedEnd != null)
  const lateDeliveryRate =
    finished.length > 0
      ? finished.filter((p) => p.actualEnd!.getTime() > p.plannedEnd!.getTime()).length /
        finished.length
      : 0

  const inspections = await prisma.inspection.findMany({
    where: { project: { contractorId }, passed: { not: null } },
    select: { passed: true },
  })
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
    case RiskEntityType.SECTOR:
      return collectSectorSignals(entityId)
    case RiskEntityType.CIRCLE:
      return collectCircleSignals(entityId)
    case RiskEntityType.ZONE:
      return collectZoneSignals(entityId)
    case RiskEntityType.DEPARTMENT:
      return collectDepartmentSignals(entityId)
    case RiskEntityType.PROJECT:
      return collectProjectSignals(entityId)
    case RiskEntityType.CONTRACTOR:
      return collectContractorSignals(entityId)
  }
}

async function labelFor(entityType: RiskEntityType, entityId: number): Promise<string> {
  switch (entityType) {
    case RiskEntityType.SECTOR: {
      const s = await prisma.sector.findUnique({ where: { id: entityId } })
      return s ? `Sector ${s.number} — ${s.name}` : `Sector #${entityId}`
    }
    case RiskEntityType.CIRCLE: {
      const c = await prisma.circle.findUnique({ where: { id: entityId } })
      return c ? c.name : `Circle #${entityId}`
    }
    case RiskEntityType.ZONE: {
      const z = await prisma.zone.findUnique({ where: { id: entityId } })
      return z ? z.name : `Zone #${entityId}`
    }
    case RiskEntityType.DEPARTMENT: {
      const d = await prisma.department.findUnique({ where: { id: entityId } })
      return d ? d.name : `Department #${entityId}`
    }
    case RiskEntityType.PROJECT: {
      const p = await prisma.project.findUnique({ where: { id: entityId } })
      return p ? p.name : `Project #${entityId}`
    }
    case RiskEntityType.CONTRACTOR: {
      const c = await prisma.contractor.findUnique({ where: { id: entityId } })
      return c ? c.name : `Contractor #${entityId}`
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
export function latestScore(entityType: RiskEntityType, entityId: number) {
  return prisma.riskScore.findFirst({
    where: { entityType, entityId },
    orderBy: { computedAt: 'desc' },
  })
}

/**
 * Rescore everything.
 *
 * Order matters twice: geography runs bottom-up because a circle aggregates its
 * sectors, and projects run before contractors because a contractor's dominant
 * factor is the average risk of its own projects.
 */
export async function recomputeAll(): Promise<Record<string, number>> {
  const [sectors, circles, zones, departments, projects, contractors] = await Promise.all([
    prisma.sector.findMany({ select: { id: true } }),
    prisma.circle.findMany({ select: { id: true } }),
    prisma.zone.findMany({ select: { id: true } }),
    prisma.department.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
    prisma.project.findMany({ select: { id: true } }),
    prisma.contractor.findMany({ select: { id: true } }),
  ])

  for (const s of sectors) await recomputeEntity(RiskEntityType.SECTOR, s.id)
  for (const c of circles) await recomputeEntity(RiskEntityType.CIRCLE, c.id)
  for (const z of zones) await recomputeEntity(RiskEntityType.ZONE, z.id)
  for (const d of departments) await recomputeEntity(RiskEntityType.DEPARTMENT, d.id)
  for (const p of projects) await recomputeEntity(RiskEntityType.PROJECT, p.id)
  for (const c of contractors) await recomputeEntity(RiskEntityType.CONTRACTOR, c.id)

  const counts = {
    sectors: sectors.length,
    circles: circles.length,
    zones: zones.length,
    departments: departments.length,
    projects: projects.length,
    contractors: contractors.length,
  }
  log.info('recomputed', counts)
  return counts
}

/**
 * Rescore a sector and everything above it, without blocking the request that
 * triggered it.
 *
 * A citizen filing a complaint should not wait on risk analysis, and a scoring
 * failure must never fail their submission.
 */
export function scheduleSectorRescore(sectorId: number): void {
  setImmediate(() => {
    void (async () => {
      try {
        await recomputeEntity(RiskEntityType.SECTOR, sectorId)
        const sector = await prisma.sector.findUnique({
          where: { id: sectorId },
          include: { circle: true },
        })
        if (!sector) return
        await recomputeEntity(RiskEntityType.CIRCLE, sector.circleId)
        await recomputeEntity(RiskEntityType.ZONE, sector.circle.zoneId)
      } catch (err) {
        log.error(`background rescore of sector ${sectorId} failed`, err)
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
