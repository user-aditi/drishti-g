/**
 * GRIE — Governance Risk Intelligence Engine.
 *
 * The v1 scorer is a deliberately transparent weighted sum. That is not a
 * placeholder for a "real" model: the project's research question is whether an
 * interpretable score costs accuracy against a black box, so this *is* the
 * treatment condition. The comparison model is the control and gets built later,
 * alongside the experiment harness.
 *
 * Every score returns its factors: raw value, how it was normalised to 0-100,
 * the weight applied, the resulting contribution, and a sentence a municipal
 * officer can read. A score without an explanation is a bug, not a shortcut.
 */
import { RiskBand, RiskEntityType } from '@prisma/client'

export const MODEL_VERSION = 'v1-weighted'

/** Score at or above which GRIE raises a flag for human review. */
export const REVIEW_THRESHOLD = 60

export interface Factor {
  key: string
  label: string
  weight: number
  /** raw value -> 0-100. Kept explicit so the paper can report each curve. */
  normalise: (raw: number) => number
  describe: (raw: number) => string
}

/**
 * Scale a raw value linearly onto 0-100, flattening once it passes `cap`.
 *
 * Capping matters: without it, one catastrophic project would saturate a
 * contractor's score and hide every other signal.
 */
const linear =
  (cap: number) =>
  (raw: number): number =>
    raw <= 0 ? 0 : Math.min(100, (raw / cap) * 100)

/** A raw value already expressed as a 0-1 proportion. */
const proportion = (raw: number): number => Math.max(0, Math.min(100, raw * 100))

const boolean01 = (raw: number): number => (raw ? 100 : 0)

/** Already on a 0-100 scale. */
const identity = (raw: number): number => Math.max(0, Math.min(100, raw))

const pct = (raw: number) => `${Math.round(raw * 100)}%`

// --- Factor definitions -----------------------------------------------------
// Weights within each set sum to 1.0. They are the tunable part of the model:
// the paper's fine-tuning step adjusts these and reports the before/after.

/**
 * How many open complaints reads as "completely saturated", per scope.
 *
 * This has to be scope-aware. A single sector is in serious trouble at 25 open
 * complaints — that is the same threshold GCCE uses to start escalating new
 * arrivals — whereas a zone aggregating six sectors would hit 25 on a good day.
 * One shared cap made the factor inert at sector level and hair-trigger at zone
 * level.
 */
export const LOAD_CAP: Record<RiskEntityType, number> = {
  [RiskEntityType.SECTOR]: 25,
  [RiskEntityType.CIRCLE]: 70,
  [RiskEntityType.ZONE]: 180,
  [RiskEntityType.DEPARTMENT]: 250,
  [RiskEntityType.PROJECT]: 20,
  [RiskEntityType.CONTRACTOR]: 20,
}

/**
 * Shared by every geographic scope.
 *
 * A sector, a circle and a zone are the same kind of thing at different
 * magnifications, so they are judged on the same five measures — which also
 * means a circle's score is directly comparable to its sectors'. Only the load
 * cap changes with scope, via `areaFactorsFor`.
 */
export const AREA_FACTORS: Factor[] = [
  {
    key: 'slaBreachRate',
    label: 'Missed deadlines',
    weight: 0.28,
    normalise: proportion,
    describe: (raw) =>
      raw > 0
        ? `${pct(raw)} of complaints missed their resolution deadline.`
        : 'Every complaint was resolved within its deadline.',
  },
  {
    key: 'repeatComplaintRate',
    label: 'Repeat complaints',
    weight: 0.27,
    normalise: proportion,
    describe: (raw) =>
      raw > 0
        ? `${pct(raw)} of complaints here repeat an issue already reported in this area.`
        : 'No repeated complaints in this area.',
  },
  {
    key: 'escalationRate',
    label: 'Escalations',
    weight: 0.2,
    normalise: proportion,
    describe: (raw) =>
      raw > 0
        ? `${pct(raw)} of complaints had to be escalated to a senior officer.`
        : 'No complaint needed escalating to a senior officer.',
  },
  {
    key: 'openComplaintLoad',
    label: 'Open complaint load',
    weight: 0.15,
    normalise: linear(LOAD_CAP[RiskEntityType.SECTOR]),
    describe: (raw) =>
      raw > 0
        ? `${Math.round(raw)} complaints are currently open here.`
        : 'No complaints are currently open.',
  },
  {
    key: 'avgResolutionDays',
    label: 'Resolution speed',
    weight: 0.1,
    // 14 days, not 30: the loosest SLA in the system is 96 hours, so a
    // fortnight to close a complaint is already a complete failure, not a
    // midpoint.
    normalise: linear(14),
    describe: (raw) =>
      raw > 0
        ? `Complaints take ${raw.toFixed(1)} days to resolve on average.`
        : 'Not enough resolved complaints to measure speed yet.',
  },
]

export const PROJECT_FACTORS: Factor[] = [
  {
    key: 'budgetOverrun',
    label: 'Budget overrun',
    weight: 0.3,
    normalise: linear(0.5), // 50% over budget reads as maximum risk
    describe: (raw) =>
      raw > 0
        ? `Spending is ${pct(raw)} over the allocated budget.`
        : 'Spending is within the allocated budget.',
  },
  {
    key: 'scheduleDelayDays',
    label: 'Schedule delay',
    weight: 0.25,
    normalise: linear(180), // 180 days late reads as maximum risk
    describe: (raw) =>
      raw > 0
        ? `Running ${Math.round(raw)} days past the planned completion date.`
        : 'On or ahead of schedule.',
  },
  {
    key: 'inspectionFailureRate',
    label: 'Inspection failures',
    weight: 0.25,
    normalise: proportion,
    describe: (raw) =>
      raw > 0 ? `${pct(raw)} of site inspections were failed.` : 'No failed inspections on record.',
  },
  {
    key: 'linkedComplaints',
    label: 'Linked complaints',
    weight: 0.2,
    normalise: linear(20),
    describe: (raw) =>
      raw > 0
        ? `${Math.round(raw)} citizen complaints are linked to this project's sector.`
        : 'No linked citizen complaints.',
  },
]

export const CONTRACTOR_FACTORS: Factor[] = [
  {
    key: 'avgProjectRisk',
    label: 'Average project risk',
    weight: 0.4,
    normalise: identity,
    describe: (raw) => `Their projects average a risk score of ${Math.round(raw)}/100.`,
  },
  {
    key: 'lateDeliveryRate',
    label: 'Late delivery history',
    weight: 0.3,
    normalise: proportion,
    describe: (raw) =>
      raw > 0
        ? `${pct(raw)} of their completed projects finished late.`
        : 'No history of late delivery.',
  },
  {
    key: 'inspectionFailureRate',
    label: 'Inspection failures',
    weight: 0.2,
    normalise: proportion,
    describe: (raw) =>
      raw > 0
        ? `${pct(raw)} of inspections across their work were failed.`
        : 'No failed inspections across their work.',
  },
  {
    key: 'isBlacklisted',
    label: 'Blacklisting',
    weight: 0.1,
    normalise: boolean01,
    describe: (raw) => (raw ? 'This contractor is currently blacklisted.' : 'Not blacklisted.'),
  },
]

/** The area factor set with its load cap set for this scope. */
function areaFactorsFor(entityType: RiskEntityType): Factor[] {
  const cap = LOAD_CAP[entityType]
  return AREA_FACTORS.map((f) =>
    f.key === 'openComplaintLoad' ? { ...f, normalise: linear(cap) } : f,
  )
}

export const FACTOR_SETS: Record<RiskEntityType, Factor[]> = {
  [RiskEntityType.SECTOR]: areaFactorsFor(RiskEntityType.SECTOR),
  [RiskEntityType.CIRCLE]: areaFactorsFor(RiskEntityType.CIRCLE),
  [RiskEntityType.ZONE]: areaFactorsFor(RiskEntityType.ZONE),
  [RiskEntityType.DEPARTMENT]: areaFactorsFor(RiskEntityType.DEPARTMENT),
  [RiskEntityType.PROJECT]: PROJECT_FACTORS,
  [RiskEntityType.CONTRACTOR]: CONTRACTOR_FACTORS,
}

export interface FactorBreakdown {
  factor: string
  label: string
  raw: number
  normalised: number
  weight: number
  contribution: number
  explanation: string
}

export interface ScoreResult {
  entityType: RiskEntityType
  entityId: number
  score: number
  band: RiskBand
  factors: FactorBreakdown[]
  modelVersion: string
  needsReview: boolean
  topReason: string
}

export function bandFor(score: number): RiskBand {
  if (score >= 80) return RiskBand.SEVERE
  if (score >= 60) return RiskBand.HIGH
  if (score >= 40) return RiskBand.MODERATE
  return RiskBand.LOW
}

export type Signals = Record<string, number | null | undefined>

/**
 * Turn raw signals into an explained 0-100 risk score.
 *
 * A missing signal scores 0 for that factor rather than throwing: an entity
 * with no inspections yet should read as low risk, not as unscoreable.
 */
export function scoreEntity(
  entityType: RiskEntityType,
  entityId: number,
  signals: Signals,
): ScoreResult {
  const factors: FactorBreakdown[] = []
  let total = 0

  for (const factor of FACTOR_SETS[entityType]) {
    const raw = Number(signals[factor.key] ?? 0) || 0
    const normalised = factor.normalise(raw)
    const contribution = normalised * factor.weight
    total += contribution
    factors.push({
      factor: factor.key,
      label: factor.label,
      raw: Number(raw.toFixed(4)),
      normalised: Number(normalised.toFixed(2)),
      weight: factor.weight,
      contribution: Number(contribution.toFixed(2)),
      explanation: factor.describe(raw),
    })
  }

  const score = Number(Math.min(100, total).toFixed(2))
  // Descending contribution: an explanation should lead with what mattered most.
  factors.sort((a, b) => b.contribution - a.contribution)

  return {
    entityType,
    entityId,
    score,
    band: bandFor(score),
    factors,
    modelVersion: MODEL_VERSION,
    needsReview: score >= REVIEW_THRESHOLD,
    topReason: factors[0]?.explanation ?? 'No contributing factors recorded.',
  }
}
