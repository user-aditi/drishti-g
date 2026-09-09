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
 * The entity types GRIE still scores.
 *
 * PROJECT and CONTRACTOR are absent by decision rather than by oversight. Works
 * management — tenders, budget lines, milestone schedules — is a larger product
 * than this one and was never fed anything but seed rows here, so scoring it was
 * demonstrating a mechanism rather than making a claim about any real firm. The
 * enum keeps both values because historical `RiskScore` rows still carry them.
 *
 * See docs/real-world-readiness.md, Part III.
 */
export type ScorableEntityType = Exclude<RiskEntityType, 'PROJECT' | 'CONTRACTOR'>

/**
 * How many open complaints reads as "completely saturated", per scope.
 *
 * Scope-aware by necessity. A single sector is in serious trouble at 25 open
 * complaints — the same threshold GCCE uses to start escalating new arrivals —
 * whereas a zone aggregating six sectors would hit 25 on a good day. One shared
 * cap made the factor inert at sector level and hair-trigger at zone level.
 */
export const LOAD_CAP: Record<ScorableEntityType, number> = {
    // A unit's cap is not fixed: it scales with how many ground-floor units sit
    // beneath it, so the factor is neither inert at the top of the tree nor
    // hair-trigger at the bottom. This value is the single-sector default, used
    // when no computed cap is supplied.
    [RiskEntityType.ORG_UNIT]: 25,
    [RiskEntityType.DEPARTMENT]: 250,
    // Historical rows only.
    [RiskEntityType.SECTOR]: 25,
    [RiskEntityType.CIRCLE]: 70,
    [RiskEntityType.ZONE]: 180,
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
        label: 'Recurring issues',
        weight: 0.27,
        curve: { kind: 'proportion' },
        // "Repeat" means the repair did not hold: an issue of this kind was
        // closed here and then reported again. Simultaneous reports of one
        // problem are duplicates, not recurrence, and do not count — see
        // riskSignals.ts for why the looser definition had to go.
        describe: (raw) =>
            raw > 0
                ? `${pct(raw)} of complaints here report an issue this area had already resolved once.`
                : 'Nothing resolved here has been reported again.',
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

/** The area factor set with its load cap set for this scope. */
function areaFactorsFor(entityType: ScorableEntityType): Factor[] {
    const cap = LOAD_CAP[entityType]
    return AREA_FACTORS.map((f) =>
        f.key === 'openComplaintLoad' ? { ...f, curve: { kind: 'linear' as const, cap } } : f,
    )
}

export const FACTOR_SETS: Record<ScorableEntityType, Factor[]> = {
    // Scoring an area does not change with its depth, so one factor set covers
    // every unit of the tree. What does change is the saturation cap, which the
    // caller supplies per unit — see `scoreEntity`'s `loadCap`.
    [RiskEntityType.ORG_UNIT]: areaFactorsFor(RiskEntityType.ORG_UNIT),
    [RiskEntityType.DEPARTMENT]: areaFactorsFor(RiskEntityType.DEPARTMENT),
    // Historical rows only; the three tiers are one tree now.
    [RiskEntityType.SECTOR]: areaFactorsFor(RiskEntityType.SECTOR),
    [RiskEntityType.CIRCLE]: areaFactorsFor(RiskEntityType.CIRCLE),
    [RiskEntityType.ZONE]: areaFactorsFor(RiskEntityType.ZONE),
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
    entityType: ScorableEntityType
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
 *
 * `loadCap` is how many open complaints read as complete saturation for this
 * particular entity. It is a parameter rather than a constant because a zone
 * covering six sectors is not in the same trouble at 25 open complaints that a
 * single sector is — the caller computes it from how much ground the unit
 * covers, and omitting it falls back to the scope's default in `LOAD_CAP`.
 */
export function scoreEntity(
    entityType: ScorableEntityType,
    entityId: number,
    signals: Signals,
    overrideWeights?: Record<string, number>,
    loadCap?: number,
): ScoreResult {
    const factors: FactorBreakdown[] = []
    let total = 0

    for (const base of FACTOR_SETS[entityType]) {
        const factor =
            loadCap != null && base.key === 'openComplaintLoad'
                ? { ...base, curve: { kind: 'linear' as const, cap: loadCap } }
                : base
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
