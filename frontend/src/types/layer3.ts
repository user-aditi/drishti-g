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

// ---- The administrator's people and system pages (Phase 11) -------------- //

export type StaffRole = 'AGENT' | 'OFFICER' | 'SUPERVISOR' | 'COMMISSIONER' | 'ADMIN'

export interface StaffPosting {
    id: number
    startedAt: string
    orgUnit: { id: number; code: string; name: string }
}

export interface StaffRow {
    id: number
    name: string
    email: string
    role: StaffRole
    isSynthetic: boolean
    isActive: boolean
    agency: { id: number; code: string; name: string } | null
    postings: StaffPosting[]
    /** Open requests this person answers for. */
    openAssigned: number
    /** Whether the role holds a posting at all. Agents do not. */
    posted: boolean
}

export interface PeoplePage {
    rows: StaffRow[]
    total: number
    page: number
    pageSize: number
    agencies: { id: number; code: string; name: string }[]
    units: { id: number; code: string; name: string; depth: number }[]
}

export interface HandedOn {
    kept: number
    reassigned: number
    unassigned: number
}

export interface JobRun {
    name: string
    intervalMs: number
    registeredAt: string
    runs: number
    failures: number
    lastStartedAt: string | null
    lastFinishedAt: string | null
    lastDurationMs: number | null
    lastResult: Record<string, number> | null
    lastError: string | null
}

export interface SystemState {
    status: 'ok' | 'degraded'
    postgres: { ok: boolean; detail: string }
    clock: { referenceDate: string; wallClock: string; rule: string }
    process: { nodeEnv: string; startedAt: string; uptimeSeconds: number; node: string }
    specs: { name: string; file: string; contract: string; loaded: boolean; modelVersion: string | null }[]
    jobs: JobRun[]
    corpus: { requests: number; imported: number; live: number; open: number }
    people: { byRole: { role: string; active: number; inactive: number }[]; activePostings: number }
    chain: { length: number; head: { id: number; hash: string; createdAt: string; action: string } | null }
}

export interface PersonDetail {
    person: Omit<StaffRow, 'postings'> & {
        postings: (StaffPosting & { endedAt: string | null; agency: { id: number; code: string; name: string } })[]
    }
    history: {
        id: number
        action: string
        entityType: string
        entityId: string
        actorLabel: string | null
        payload: Record<string, unknown> | null
        createdAt: string
    }[]
    agencies: { id: number; code: string; name: string }[]
    units: { id: number; code: string; name: string; depth: number }[]
    isSelf: boolean
}
