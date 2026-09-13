import type { Layer1Request } from './layer1'

/**
 * Layer 2's vocabulary — escalation. Ours, not NYC's: 311 records none.
 */

export type EscalationTrigger = 'SLA_BREACH' | 'MANUAL'

interface Person {
    name: string
    isSynthetic: boolean
}

export interface EscalationView {
    id: number
    fromLevel: number
    toLevel: number
    toLevelName: string
    trigger: EscalationTrigger
    reason: string
    at: string
    /** Null when the sweep raised it. */
    raisedBy: Person | null
    /** Null only if nobody holds that rung in the agency. */
    toUser: Person | null
    /** When whoever holds the rung said they had it, and what they said. */
    acknowledgedAt: string | null
    acknowledgedBy: Person | null
    acknowledgeNote: string | null
    /** When the request closed. Cleared if it is reopened. */
    resolvedAt: string | null
}

export interface EscalatedRequest extends Layer1Request {
    escalationLevel: number
    escalationLevelName: string
    escalations: EscalationView[]
}

export interface EscalationsPage {
    /** Each row carries the rungs the viewer may acknowledge now. */
    rows: (EscalatedRequest & { acknowledgeable: number[] })[]
    total: number
    page: number
    pageSize: number
    referenceDate: string
}

export interface RequestEscalations {
    srNumber: string
    requestId: number
    status: string
    escalationLevel: number
    escalationLevelName: string
    nextLevelName: string | null
    canEscalate: boolean
    escalations: EscalationView[]
    /** Rungs on this request the viewer may acknowledge now. */
    acknowledgeable: number[]
}
