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
}

export interface EscalatedRequest extends Layer1Request {
    escalationLevel: number
    escalationLevelName: string
    escalations: EscalationView[]
}

export interface EscalationsPage {
    rows: EscalatedRequest[]
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
}
