/**
 * Layer 3's vocabulary — GRIE's risk register and GCCE's routing report. Ours:
 * NYC 311 scores nothing and routes by complaint type.
 */

export interface RiskFactor {
    factor: string
    label: string
    raw: number
    normalised: number
    weight: number
    contribution: number
    explanation: string
}

export interface RiskRow {
    id: number
    agency: { code: string; name: string }
    board: { code: string; name: string }
    month: string
    requests: number
    /** Weighted sum on 0-100. Ranks; not a probability. */
    score: number
    /** Calibrated chance of landing in the worst fifth next month. */
    probability: number
    needsReview: boolean
    rank: number
    of: number
    factors: RiskFactor[]
    signals: Record<string, number>
    nextBreachRate: number | null
    outcome: boolean | null
}

export interface RiskLabel {
    description: string
    quantile: number
    cutoff: number
    baseRate: number
}

export interface RiskUnitsPage {
    modelVersion: string
    reviewProbability: number
    label: RiskLabel
    months: { month: string; units: number; flagged: number }[]
    agency: string | null
    month: string | null
    rows: RiskRow[]
}

export interface CandidateEvaluation {
    cvAuc: number
    cvAucSd: number
    withinAgencyAuc: number
    maxSaturation: number
    saturatedFactor: string
}

export interface AucGap {
    aucGap: number
    ciLow: number
    ciHigh: number
}

export type RiskCurve =
    | { kind: 'proportion' }
    | { kind: 'linear'; cap: number; capByAgency?: Record<string, number> }

export interface RiskModel {
    modelVersion: string
    chosen: string
    unit: string
    label: RiskLabel
    trainedOn: { rows: number; units: number; firstMonth: string; lastMonth: string }
    minRequests: number
    reviewProbability: number
    factors: { key: string; label: string; weight: number; curve: RiskCurve }[]
    handSpecified: { weights: Record<string, number>; caps: Record<string, number> }
    evaluation: {
        candidates: Record<string, CandidateEvaluation>
        shippedVsHand: AucGap
        shippedVsPersistence: AucGap
        calibration: Record<string, number>
    }
}

export interface RoutingCell {
    level: number
    type: string
    values: string[]
    agency: string
    support: number
    share: number
}

export interface RoutingReport {
    modelVersion: string
    trainedAt: string
    chosen: string
    chain: string[][]
    minSupport: number
    evaluation: {
        trainedOn: string
        testYear: number
        testRows: number
        accuracy: Record<string, number>
        validation: Record<string, number>
        perType: Record<string, { rows: number; modal: number; chosen: number }>
        gainOverModal: { gain: number; ciLow: number; ciHigh: number }
        gatePassed: boolean
    }
    cells: RoutingCell[]
    scope: {
        typesMeasured: string[]
        brooklynTypes2024: number
        sharedTypes2024: number
        sharedShareOfRequests2024: number
    }
}

export interface AuditRow {
    id: number
    action: string
    entityType: string
    entityId: string | number
    actorLabel: string | null
    source: string
    payload: unknown
    hash: string
    prevHash: string
    createdAt: string
}

export interface AuditPage {
    rows: AuditRow[]
    total: number
    page: number
    pageSize: number
    actions: { action: string; count: number }[]
}

export interface ChainVerification {
    ok: boolean
    checked: number
    head: string | null
    brokenAt: number | null
    reason: string | null
}

export interface RecomputeResult {
    modelVersion: string
    unitMonths: number
    flagged: number
    firstMonth: string | null
    lastMonth: string | null
    tookMs: number
}
