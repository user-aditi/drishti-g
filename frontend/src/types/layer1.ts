import type { ServiceRequest, StatusChange } from './index'

/**
 * Layer 1's vocabulary — officer identity. Ours, not NYC's.
 *
 * Kept out of `types/index.ts` on purpose. That file is the baseline's, and
 * everything named in it exists in NYC's published data; nothing here does.
 */

export type WorkOrderState = 'ISSUED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'

/**
 * The one person accountable for a request.
 *
 * `isSynthetic` is always true in this replica — NYC records no case-worker
 * identity — and it travels with the name so no screen can show one without it.
 */
export interface Accountable {
    id: number
    name: string
    isSynthetic: boolean
}

export interface WorkOrderView {
    id: number
    code: string
    instructions: string | null
    issuedAt: string
    expiresAt: string
    completedAt: string | null
    completionNote: string | null
    state: WorkOrderState
}

export interface Layer1Request extends ServiceRequest {
    accountable: Accountable | null
    /** When this system made the assignment — real time, often years after filing. */
    assignedAt: string | null
    workOrders: WorkOrderView[]
}

export interface Layer1Detail extends Layer1Request {
    history: StatusChange[]
    slaNote: string | null
}

export interface Desk {
    rows: Layer1Request[]
    total: number
    overdue: number
    page: number
    pageSize: number
    referenceDate: string
}

export interface UnassignedPage {
    rows: Layer1Request[]
    total: number
    page: number
    pageSize: number
    referenceDate: string
}

export interface OfficerSummary {
    id: number
    name: string
    isSynthetic: boolean
    units: { id: number; code: string; name: string }[]
    openLoad: number
}

export interface IssuedWorkOrder {
    id: number
    code: string
    link: string
    /** A PNG data URI of the link, ready to show or print. */
    qrDataUrl: string
    issuedAt: string
    expiresAt: string
    state: WorkOrderState
}

/** What a crew sees: the job, and nothing about who reported it. */
export interface PublicWorkOrder {
    code: string
    state: WorkOrderState
    issuedAt: string
    expiresAt: string
    completedAt: string | null
    instructions: string | null
    job: {
        srNumber: string
        what: string
        detail: string | null
        address: string | null
        board: { code: string; name: string } | null
        latitude: number | null
        longitude: number | null
    }
    issuedBy: { name: string; isSynthetic: boolean }
}

export interface WorkOrderQr {
    code: string
    link: string
    qrDataUrl: string
    state: WorkOrderState
}
