import type { RequestStatus } from '@/types'

/**
 * Layer 4's vocabulary — what a photograph sent back from a job is taken to
 * prove. Ours: NYC 311 closes a request with a sentence of agency text.
 */

export type ProofOutcome = 'REJECTED' | 'NEEDS_CITIZEN' | 'NEEDS_OFFICER' | 'CONFIRMED'

export interface ProofCheck {
    check: string
    label: string
    passed: boolean
    weight: number
    contribution: number
    detail: string
}

export interface ProofView {
    /** 0–100 across the checks. Evidence of bad faith, not a probability of repair. */
    score: number
    outcome: ProofOutcome
    checks: ProofCheck[]
}

export interface CrewSubmission {
    ok: boolean
    state: string
    message: string
    proof: ProofView
    photos: string[]
}

/** What a job's code will tell you about a submission already made. */
export interface CrewProof {
    code: string
    proof: ProofView | null
    message: string | null
    photos: ProofPhoto[]
    /** Set once an officer has decided, and carrying the sentence they wrote. */
    decision: { outcome: ProofOutcome; note: string | null; decidedAt: string } | null
}

export interface ProofPhoto {
    storedName: string
    uploadedAt: string
}

export interface ProofQueueRow {
    workOrderId: number
    code: string
    completedAt: string | null
    completionNote: string | null
    request: {
        id: number
        srNumber: string
        status: RequestStatus
        address: string | null
        type: { name: string } | null
        orgUnit: { code: string; name: string } | null
        assignedOfficer: { name: string; isSynthetic: boolean } | null
    }
    proof: ProofView | null
    citizenVerdict: boolean | null
    photos: ProofPhoto[]
}

export interface ProofQueue {
    rows: ProofQueueRow[]
}

/** What the resident who reported a request is being asked, if anything. */
export interface CitizenQuestion {
    workOrderId: number
    srNumber: string
    completedAt: string | null
    completionNote: string | null
    photos: ProofPhoto[]
    proof: ProofView
}

/** A job a crew says is finished, on a request this resident reported and has not answered. */
export interface WaitingRow {
    workOrderId: number
    srNumber: string
    type: string
    address: string | null
    completedAt: string | null
}

export interface Waiting {
    rows: WaitingRow[]
}
