/**
 * The Layer 0 vocabulary.
 *
 * Everything named in this file exists in NYC's own published 311 data. That
 * is the whole constraint: this layer is the uncontaminated baseline that later
 * layers are measured against, so a concept invented by this project — anything
 * about who owns a request internally, how it is prioritised, or how risky it
 * looks — cannot appear here without contaminating the comparison.
 */

/** The statuses NYC publishes. `UNSPECIFIED` is theirs too, and it is common. */
export type RequestStatus =
    | 'OPEN'
    | 'ASSIGNED'
    | 'STARTED'
    | 'IN_PROGRESS'
    | 'PENDING'
    | 'CLOSED'
    | 'UNSPECIFIED'

/** How the request reached 311. */
export type Channel = 'PHONE' | 'ONLINE' | 'MOBILE' | 'OTHER' | 'UNKNOWN'

/**
 * CITIZEN and AGENT are Layer 0 — NYC's own model of 311. OFFICER and SUPERVISOR
 * are Layer 1 and ours: NYC records no case-worker identity, so every account
 * holding one is synthetic and is shown as such.
 */
export type Role = 'CITIZEN' | 'AGENT' | 'OFFICER' | 'SUPERVISOR'

export interface Agency {
    id: number
    code: string
    name: string
}

export interface Descriptor {
    id: number
    name: string
}

/** A community board — Brooklyn has 18, coded BK-01 through BK-18. */
export interface OrgUnitRef {
    id: number
    code: string
    name: string
}

export interface RequestTypeRef {
    id: number
    code: string
    name: string
}

/**
 * A complaint type, with the deadline this project derived for it.
 *
 * `slaNote` is not decoration. NYC publishes no due date for any of these
 * types — zero rows out of 355,430 — so every hour figure here was computed
 * from observed closure times, and the note says how. It must travel with the
 * number wherever the number is shown.
 */
export interface RequestType extends RequestTypeRef {
    slaHours: number
    slaSource: string
    slaNote: string
    agency: Agency | null
    descriptors: Descriptor[]
}

export interface ServiceRequest {
    id: number
    srNumber: string
    status: RequestStatus
    channel: Channel
    type: RequestTypeRef | null
    descriptor: Descriptor | null
    agency: Agency | null
    orgUnit: OrgUnitRef | null
    createdAt: string
    closedAt: string | null
    slaDueAt: string | null
    /** Derived at read time from `slaDueAt`, never a stored status. */
    isOverdue: boolean
    latitude: number | null
    longitude: number | null
    address: string | null
    zip: string | null
    councilDistrict: string | null
    policePrecinct: string | null
    resolutionNote: string | null
    /**
     * True for a row loaded from NYC Open Data — a historical record of
     * something New York did. False for one filed through this replica.
     * A reader is entitled to know which they are looking at.
     */
    isImported: boolean
}

/**
 * One recorded status transition.
 *
 * An imported request has exactly one of these: its arrival in the state NYC
 * last published. NYC publishes no status history, and the API refuses to
 * invent the steps in between, so a short timeline here is the honest one.
 */
export interface StatusChange {
    id: number
    fromStatus: RequestStatus | null
    toStatus: RequestStatus
    at: string
    note: string | null
}

/** What the public lookup returns: the request, its history, its derivation. */
export interface RequestDetail extends ServiceRequest {
    history: StatusChange[]
    slaNote: string | null
}

/** A community board with its published volume figures. */
export interface Board {
    id: number
    code: string
    name: string
    centroidLat: number | null
    centroidLon: number | null
    total: number
    open: number
    closed: number
    overdue: number
    medianResolutionHours: number | null
}

/** A board as a picker offers it, before anyone has signed in. */
export interface Area {
    id: number
    name: string
    code: string
    kindLabel: string | null
}

/** One dot on the map: a server-side cluster, never an individual row. */
export interface MapCluster {
    lat: number
    lng: number
    count: number
}

/**
 * A page of rows.
 *
 * `referenceDate` rides along with every register page for a reason: nothing on
 * this screen is measured against the wall clock. "Overdue" is evaluated against
 * the snapshot date the corpus was pulled on, so a count of overdue requests is
 * meaningless without the day it was counted on.
 */
export interface Paged<T> {
    rows: T[]
    total: number
    page: number
    pageSize: number
    referenceDate: string
}

export interface User {
    id: number
    email: string
    name: string
    role: Role
    agency: Agency | null
    orgUnit: OrgUnitRef | null
    /**
     * True for the seeded staff accounts. NYC publishes no case-worker
     * identity, so every agent here stands in for a role the data does not
     * record — and the interface has to be able to say so.
     */
    isSynthetic: boolean
}

/** Login and registration hand back tokens *and* set the session cookie. */
export interface AuthResult {
    accessToken: string
    refreshToken: string
    user: User
}

export interface AuditVerification {
    ok: boolean
    checked: number
    head: string | null
    brokenAt: string | null
    reason: string | null
}

export interface Health {
    status: string
    postgres: { ok: boolean; detail: string }
    referenceDate: string
}

/** The body `POST /requests` accepts. No auth: NYC takes anonymous reports. */
export interface NewRequest {
    typeId: number
    descriptorId?: number
    address?: string
    latitude?: number
    longitude?: number
    zip?: string
    orgUnitId?: number
    channel: Channel
}

/**
 * How the register may be ordered.
 *
 * These three are the API's whole sort vocabulary, and they are the three
 * questions a queue is actually asked: what has been waiting longest, what just
 * arrived, and what is closest to its derived deadline.
 */
export type QueueSort = 'age' | 'newest' | 'due'

/** Query shape for the agent register. Every field is optional but `page`. */
export interface QueueQuery {
    agencyId?: number
    orgUnitId?: number
    typeId?: number
    status?: RequestStatus
    openOnly?: boolean
    overdue?: boolean
    page: number
    pageSize: number
    sort?: QueueSort
}
