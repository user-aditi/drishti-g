/**
 * GRIE — Governance Risk Intelligence Engine.
 *
 * The v1 scorer is a deliberately transparent weighted sum. That is not a
 * placeholder for a "real" model: the project's research question is whether an
 * interpretable score costs accuracy against a black box, so this *is* the
 * treatment condition. The comparison model is the control, built in
 * research/ alongside the experiment harness.
 *
 * The model is declared as **data**, not code: every factor carries its weight
 * and a named normalisation curve rather than an opaque function. Three things
 * follow from that, and all three matter.
 *
 *   1. The exact model can be serialised (see `modelSpec()`) and handed to the
 *      Python experiment harness, so the paper compares the code that actually
 *      runs — not a re-implementation that may have drifted.
 *   2. Weight tuning is a data transform, not a code change.
 *   3. A reader can inspect the whole model without reading any logic.
 *
 * Every score returns its factors: raw value, how it was normalised to 0-100,
 * the weight applied, the resulting contribution, and a sentence a municipal
 * officer can read. A score without an explanation is a bug, not a shortcut.
 */
import { RiskBand, RiskEntityType } from '@prisma/client'

export const MODEL_VERSION = 'v1-weighted'

/** Score at or above which GRIE raises a flag for human review. */
export const REVIEW_THRESHOLD = 60

/**
 * How a raw signal is mapped onto 0-100.
 *
 * `linear` flattens once the raw value passes `cap`. Capping matters: without
 * it one catastrophic project would saturate a contractor's score and hide
 * every other signal.
 */
export type Curve =
    | { kind: 'linear'; cap: number }
    | { kind: 'proportion' }
    | { kind: 'boolean' }
    | { kind: 'identity' }

export function applyCurve(curve: Curve, raw: number): number {
    switch (curve.kind) {
        case 'linear':
            return raw <= 0 ? 0 : Math.min(100, (raw / curve.cap) * 100)
        case 'proportion':
            return Math.max(0, Math.min(100, raw * 100))
        case 'boolean':
            return raw ? 100 : 0
        case 'identity':
            return Math.max(0, Math.min(100, raw))
    }
}

export interface Factor {
    key: string
    label: string
    weight: number
    curve: Curve
    describe: (raw: number) => string
}

const pct = (raw: number) => `${Math.round(raw * 100)}%`

// --- Calibration -------------------------------------------------------------

/**
 * How many open complaints reads as "completely saturated", per scope.
 *
 * Scope-aware by necessity. A single sector is in serious trouble at 25 open
 * complaints — the same threshold GCCE uses to start escalating new arrivals —
 * whereas a zone aggregating six sectors would hit 25 on a good day. One shared
 * cap made the factor inert at sector level and hair-trigger at zone level.
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
 * Days to resolution that reads as total failure.
 *
 * 14, not 30: the loosest SLA in the system is 96 hours, so a fortnight to
 * close a complaint is already a complete failure rather than a midpoint.
 */
const RESOLUTION_CAP_DAYS = 14

// --- Factor definitions ------------------------------------------------------
// Weights within each set sum to 1.0. They are the tunable part of the model:
// the paper's fine-tuning step adjusts these and reports the before/after.

/**
 * Shared by every geographic scope.
 *
 * A sector, a circle and a zone are the same kind of thing at different
 * magnifications, so they are judged on the same five measures — which also
 * makes a circle's score directly comparable to its sectors'. Only the load cap
 * changes with scope, via `areaFactorsFor`.
 */
export const AREA_FACTORS: Factor[] = [
    {
        key: 'slaBreachRate',
        label: 'Missed deadlines',
        weight: 0.28,
        curve: { kind: 'proportion' },
        describe: (raw) =>
            raw > 0
                ? `${pct(raw)} of complaints missed their resolution deadline.`
                : 'Every complaint was resolved within its deadline.',
    },
    {
        key: 'repeatComplaintRate',
        label: 'Repeat complaints',
        weight: 0.27,
        curve: { kind: 'proportion' },
        describe: (raw) =>
            raw > 0
                ? `${pct(raw)} of complaints here repeat an issue already reported in this area.`
                : 'No repeated complaints in this area.',
    },
    {
        key: 'escalationRate',
        label: 'Escalations',
        weight: 0.2,
        curve: { kind: 'proportion' },
        describe: (raw) =>
            raw > 0
                ? `${pct(raw)} of complaints had to be escalated to a senior officer.`
                : 'No complaint needed escalating to a senior officer.',
    },
    {
        key: 'openComplaintLoad',
        label: 'Open complaint load',
        weight: 0.15,
        curve: { kind: 'linear', cap: LOAD_CAP[RiskEntityType.SECTOR] },
        describe: (raw) =>
            raw > 0
                ? `${Math.round(raw)} complaints are currently open here.`
                : 'No complaints are currently open.',
    },
    {
        key: 'avgResolutionDays',
        label: 'Resolution speed',
        weight: 0.1,
        curve: { kind: 'linear', cap: RESOLUTION_CAP_DAYS },
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
        curve: { kind: 'linear', cap: 0.5 }, // 50% over budget reads as maximum risk
        describe: (raw) =>
            raw > 0
                ? `Spending is ${pct(raw)} over the allocated budget.`
                : 'Spending is within the allocated budget.',
    },
    {
        key: 'scheduleDelayDays',
        label: 'Schedule delay',
        weight: 0.25,
        curve: { kind: 'linear', cap: 180 }, // 180 days late reads as maximum risk
        describe: (raw) =>
            raw > 0
                ? `Running ${Math.round(raw)} days past the planned completion date.`
                : 'On or ahead of schedule.',
    },
    {
        key: 'inspectionFailureRate',
        label: 'Inspection failures',
        weight: 0.25,
        curve: { kind: 'proportion' },
        describe: (raw) =>
            raw > 0
                ? `${pct(raw)} of site inspections were failed.`
                : 'No failed inspections on record.',
    },
    {
        key: 'linkedComplaints',
        label: 'Linked complaints',
        weight: 0.2,
        curve: { kind: 'linear', cap: 20 },
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
        curve: { kind: 'identity' },
        describe: (raw) => `Their projects average a risk score of ${Math.round(raw)}/100.`,
    },
    {
        key: 'lateDeliveryRate',
        label: 'Late delivery history',
        weight: 0.3,
        curve: { kind: 'proportion' },
        describe: (raw) =>
            raw > 0
                ? `${pct(raw)} of their completed projects finished late.`
                : 'No history of late delivery.',
    },
    {
        key: 'inspectionFailureRate',
        label: 'Inspection failures',
        weight: 0.2,
        curve: { kind: 'proportion' },
        describe: (raw) =>
            raw > 0
                ? `${pct(raw)} of inspections across their work were failed.`
                : 'No failed inspections across their work.',
    },
    {
        key: 'isBlacklisted',
        label: 'Blacklisting',
        weight: 0.1,
        curve: { kind: 'boolean' },
        describe: (raw) => (raw ? 'This contractor is currently blacklisted.' : 'Not blacklisted.'),
    },
]

/** The area factor set with its load cap set for this scope. */
function areaFactorsFor(entityType: RiskEntityType): Factor[] {
    const cap = LOAD_CAP[entityType]
    return AREA_FACTORS.map((f) =>
        f.key === 'openComplaintLoad' ? { ...f, curve: { kind: 'linear' as const, cap } } : f,
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

// --- Scoring -----------------------------------------------------------------

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
 *
 * `overrideWeights` lets the tuning experiment score with a candidate weight
 * set without mutating the production model.
 */
export function scoreEntity(
    entityType: RiskEntityType,
    entityId: number,
    signals: Signals,
    overrideWeights?: Record<string, number>,
): ScoreResult {
    const factors: FactorBreakdown[] = []
    let total = 0

    for (const factor of FACTOR_SETS[entityType]) {
        const weight = overrideWeights?.[factor.key] ?? factor.weight
        const raw = Number(signals[factor.key] ?? 0) || 0
        const normalised = applyCurve(factor.curve, raw)
        const contribution = normalised * weight
        total += contribution
        factors.push({
            factor: factor.key,
            label: factor.label,
            raw: Number(raw.toFixed(4)),
            normalised: Number(normalised.toFixed(2)),
            weight,
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

// --- Export ------------------------------------------------------------------

export interface ModelSpec {
    modelVersion: string
    reviewThreshold: number
    bands: { band: RiskBand; min: number }[]
    factorSets: Record<
        string,
        { key: string; label: string; weight: number; curve: Curve }[]
    >
}

/**
 * The whole model as plain data.
 *
 * The Python harness reads this rather than re-implementing the scorer, so the
 * paper's "interpretable model" is provably the one running in production. A
 * re-implementation that quietly drifted would invalidate the comparison, and
 * nothing would catch it.
 */
export function modelSpec(): ModelSpec {
    return {
        modelVersion: MODEL_VERSION,
        reviewThreshold: REVIEW_THRESHOLD,
        bands: [
            { band: RiskBand.SEVERE, min: 80 },
            { band: RiskBand.HIGH, min: 60 },
            { band: RiskBand.MODERATE, min: 40 },
            { band: RiskBand.LOW, min: 0 },
        ],
        factorSets: Object.fromEntries(
            Object.entries(FACTOR_SETS).map(([entityType, factors]) => [
                entityType,
                factors.map((f) => ({
                    key: f.key,
                    label: f.label,
                    weight: f.weight,
                    curve: f.curve,
                })),
            ]),
        ),
    }
}
