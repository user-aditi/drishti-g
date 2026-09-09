'use client'

import { ApiError } from './api-error'
import type {
    Complaint,
    Department,
    Job,
    RiskDetail,
    RiskEntityType,
    RiskFlag,
    RoutingDecision,
    User,
} from '@/types'

/**
 * Browser-side API client.
 *
 * Everything a user *does* — filing, allotting, inspecting, reviewing — goes
 * through here. Reads mostly happen on the server (see lib/api.ts); this is for
 * mutations and for the few panels that poll.
 *
 * `credentials: 'include'` matters: the session lives in an httpOnly cookie, so
 * a request without it is anonymous.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

let refreshInFlight: Promise<boolean> | null = null

/**
 * Exchange the refresh cookie for a fresh access cookie.
 *
 * Concurrent 401s share one in-flight refresh, so a page firing several
 * requests at once does not burn several refreshes and race.
 */
async function refreshSession(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight

    refreshInFlight = (async () => {
        try {
            const res = await fetch(`${BASE_URL}/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            })
            return res.ok
        } catch {
            return false
        } finally {
            refreshInFlight = null
        }
    })()

    return refreshInFlight
}

interface RequestOptions {
    method?: string
    body?: unknown
    /** Internal: stops a refreshed request from retrying forever. */
    retried?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, retried = false } = options
    const isFormData = body instanceof FormData

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        credentials: 'include',
        // Let the browser set the multipart boundary itself; forcing a
        // Content-Type here produces a header without one and the upload fails.
        headers: body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : undefined,
        body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    })

    if (res.status === 401 && !retried) {
        if (await refreshSession()) return request<T>(path, { ...options, retried: true })
    }

    if (!res.ok) {
        let parsed: { error?: string; details?: unknown } | null = null
        try {
            parsed = await res.json()
        } catch {
            // Non-JSON error body — fall back to the status.
        }
        throw new ApiError(res.status, parsed?.error ?? `Request failed (${res.status})`, parsed?.details)
    }

    if (res.status === 204) return undefined as T
    return (await res.json()) as T
}

const qs = (params: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') search.set(k, String(v))
    }
    const s = search.toString()
    return s ? `?${s}` : ''
}

export const apiClient = {
    // --- Session ---
    login: (email: string, password: string) =>
        request<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } }),

    register: (payload: {
        email: string
        password: string
        fullName: string
        phone?: string
        homeUnitId?: number | null
    }) => request<{ user: User }>('/auth/register', { method: 'POST', body: payload }),

    logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

    // --- Citizen ---
    fileComplaint: (form: FormData) =>
        request<{ complaint: Complaint; routing: RoutingDecision }>('/complaints', {
            method: 'POST',
            body: form,
        }),

    /**
     * The citizen's answer to "we sent this to Electrical — is that right?"
     *
     * `null` means they know it is wrong but not what it should be, which sends
     * the complaint for manual categorisation rather than to another wrong desk.
     */
    confirmCategory: (id: number, categoryId: number | null) =>
        request<{ complaint: Complaint; routing: RoutingDecision }>(
            `/complaints/${id}/category`,
            { method: 'POST', body: { categoryId } },
        ),

    submitFeedback: (id: number, rating: number, comment?: string) =>
        request<Complaint>(`/complaints/${id}/feedback`, { method: 'POST', body: { rating, comment } }),

    /**
     * Back a neighbour's community grievance, or take that backing away.
     *
     * The response says what the support did — how many people now stand behind
     * it, and whether that crossed a threshold — so the citizen sees the effect
     * rather than just a button changing colour.
     */
    supportIssue: (id: number, note?: string) =>
        request<import('@/types').SupportOutcome>(`/complaints/${id}/support`, {
            method: 'POST',
            body: { note },
        }),

    withdrawSupport: (id: number) =>
        request<import('@/types').SupportOutcome>(`/complaints/${id}/support`, {
            method: 'DELETE',
        }),

    /**
     * The citizen's verdict on work a crew reported done.
     *
     * Sent as FormData because they may attach their own photograph, which for
     * a disputed job is the most useful thing the officer will receive.
     */
    confirmWork: (id: number, form: FormData) =>
        request<{ complaint: Complaint; message: string }>(`/complaints/${id}/confirm`, {
            method: 'POST',
            body: form,
        }),

    /** Open issues near the citizen that resemble what they are typing. */
    similarNearby: (params: { categoryId?: number; q?: string }) =>
        request<{ items: import('@/types').SimilarIssue[] }>(
            `/citizen/similar${qs({ categoryId: params.categoryId, q: params.q })}`,
        ),

    updateProfile: (payload: Record<string, unknown>) =>
        request<User>('/citizen/profile', { method: 'PATCH', body: payload }),

    // --- Section Officer ---
    //
    // `crewFor` and `allotJob` used to live here. They allotted work by looking
    // up a field worker's *posting*, which stopped existing when street labour
    // moved to per-job codes — they could only ever fail. Allotment is now
    // `crew.issueWorkOrder` below.
    verifyWork: (complaintId: number, accept: boolean, note?: string) =>
        request<Complaint>(`/officer/complaints/${complaintId}/verify`, {
            method: 'POST',
            body: { accept, note },
        }),

    // --- Crew and work orders ---
    //
    // The officer's half of the code-based model: keep a roll of who works
    // your sector, and hand one of them a job addressed by a code rather than
    // an account.
    crew: {
        roll: (params: { sectorId?: number; trade?: string } = {}) =>
            request<{ items: import('@/types').CrewRow[]; canManage: boolean }>(
                `/crew${qs({ sectorId: params.sectorId, trade: params.trade })}`,
            ),

        add: (payload: Record<string, unknown>) =>
            request<import('@/types').CrewRow>('/crew', { method: 'POST', body: payload }),

        update: (id: number, payload: Record<string, unknown>) =>
            request<import('@/types').CrewRow>(`/crew/${id}`, { method: 'PATCH', body: payload }),

        /** Issue a job. Returns the code, a link, and a QR to hold up. */
        issue: (payload: { complaintId: number; crewId?: number | null; instructions?: string }) =>
            request<import('@/types').IssuedWorkOrder>('/crew/work-orders', {
                method: 'POST',
                body: payload,
            }),

        cancel: (id: number, reason?: string) =>
            request<{ ok: boolean }>(`/crew/work-orders/${id}/cancel`, {
                method: 'POST',
                body: { reason },
            }),

        /** Only the jobs neither the pipeline nor the citizen could settle. */
        verificationQueue: () =>
            request<{ items: import('@/types').VerificationQueueItem[]; total: number }>(
                '/crew/verification-queue',
            ),

        rule: (id: number, accept: boolean, note?: string) =>
            request<{ ok: boolean; accepted: boolean }>(`/crew/work-orders/${id}/rule`, {
                method: 'POST',
                body: { accept, note },
            }),
    },

    // --- Field worker ---
    jobs: (scope: 'active' | 'done' = 'active') =>
        request<{ items: Job[]; total: number }>(`/worker/jobs${qs({ scope })}`),

    completeJob: (id: number, form: FormData) =>
        request<{ id: number; status: string; message: string }>(`/worker/jobs/${id}/complete`, {
            method: 'POST',
            body: form,
        }),

    reportJobIssue: (id: number, form: FormData) =>
        request<{ id: number; message: string }>(`/worker/jobs/${id}/report-issue`, {
            method: 'POST',
            body: form,
        }),

    // --- Oversight ---
    closeComplaint: (id: number, note?: string) =>
        request<Complaint>(`/complaints/${id}/close`, { method: 'POST', body: { note } }),

    acknowledgeEscalation: (id: number) =>
        request<unknown>(`/admin/escalations/${id}/acknowledge`, { method: 'POST' }),

    runEscalationSweep: () =>
        request<{ checked: number; escalated: unknown[] }>('/admin/escalations/sweep', { method: 'POST' }),

    // --- GRIE ---
    riskQueueByStatus: (status: string) =>
        request<{ items: RiskFlag[]; total: number; threshold: number }>(
            `/risk/queue${qs({ status })}`,
        ),

    riskDetail: (entityType: RiskEntityType, entityId: number) =>
        request<RiskDetail>(`/risk/${entityType}/${entityId}`),

    reviewFlag: (id: number, status: string, note?: string) =>
        request<RiskFlag>(`/risk/flags/${id}/review`, { method: 'POST', body: { status, note } }),

    recomputeRisk: () => request<{ recomputed: unknown }>('/risk/recompute', { method: 'POST' }),

    // --- Super Admin ---
    createStaff: (payload: Record<string, unknown>) =>
        request<User>('/staff', { method: 'POST', body: payload }),

    transferStaff: (id: number, payload: Record<string, unknown>) =>
        request<User>(`/staff/${id}/transfer`, { method: 'POST', body: payload }),

    updateUser: (id: number, payload: Record<string, unknown>) =>
        request<User>(`/admin/users/${id}`, { method: 'PATCH', body: payload }),

    createDepartment: (payload: Record<string, unknown>) =>
        request<Department>('/departments', { method: 'POST', body: payload }),

    updateDepartment: (id: number, payload: Record<string, unknown>) =>
        request<Department>(`/departments/${id}`, { method: 'PATCH', body: payload }),

    verifyChain: () =>
        request<{ valid: boolean; checked: number; head?: string; brokenAtId?: number; reason?: string }>(
            '/admin/audit/verify',
        ),

    // --- Event log ---
    //
    // The complaint lifecycle as process-mining data. `request` is not usable
    // for the download itself because it parses every response as JSON; the CSV
    // is fetched as a blob instead, through the same cookie session.

    eventLogSummary: () =>
        request<{ events: number; cases: number; from: string | null; to: string | null }>(
            '/console/event-log/summary',
        ),

    /**
     * Fetch the log as a file the browser will save.
     *
     * Deliberately not a plain `<a href>` to the API: the session lives in an
     * httpOnly cookie on a different origin, and whether a link navigation
     * carries it depends on SameSite. A credentialed fetch to a blob always
     * does, and it also lets a failure surface as a message instead of a tab
     * full of JSON.
     */
    downloadEventLog: async (): Promise<{ blob: Blob; filename: string }> => {
        const res = await fetch(`${BASE_URL}/console/event-log.csv`, { credentials: 'include' })
        if (!res.ok) {
            throw new ApiError(res.status, `Could not export the event log (${res.status})`)
        }
        const disposition = res.headers.get('Content-Disposition') ?? ''
        const match = /filename="([^"]+)"/.exec(disposition)
        return { blob: await res.blob(), filename: match?.[1] ?? 'drishti-event-log.csv' }
    },

    // --- Control room ---
    //
    // Every call here is Super Admin only and audited server-side. Grouped by
    // register so the console pages read as `console.zones.create(...)`.
    console: {
        // The zones / circles / sectors editors used to sit here. Geography is
        // one recursive tree now, so drawing it is `org.createUnit` above —
        // one call that works at any depth instead of three fixed tiers.
        designations: {
            /** Upsert: there is exactly one title per department and rank. */
            set: (payload: Record<string, unknown>) =>
                request<{ id: number }>('/console/designations', { method: 'PUT', body: payload }),
            remove: (id: number) => request<void>(`/console/designations/${id}`, { method: 'DELETE' }),
        },
        categories: {
            create: (payload: Record<string, unknown>) =>
                request<{ id: number }>('/console/categories', { method: 'POST', body: payload }),
            update: (id: number, payload: Record<string, unknown>) =>
                request<{ id: number }>(`/console/categories/${id}`, { method: 'PATCH', body: payload }),
            remove: (id: number) => request<void>(`/console/categories/${id}`, { method: 'DELETE' }),
        },
        staff: {
            file: (id: number) => request<import('@/types').StaffFile>(`/console/staff/${id}`),
            resetPassword: (id: number, password: string) =>
                request<{ ok: boolean }>(`/console/staff/${id}/password`, {
                    method: 'POST',
                    body: { password },
                }),
            addPosting: (id: number, payload: Record<string, unknown>) =>
                request<User>(`/console/staff/${id}/postings`, { method: 'POST', body: payload }),
            endPosting: (postingId: number) =>
                request<void>(`/console/postings/${postingId}`, { method: 'DELETE' }),
        },
        complaints: {
            candidates: (id: number) =>
                request<{ items: import('@/types').AssignCandidate[] }>(
                    `/console/complaints/${id}/candidates`,
                ),
            assign: (id: number, payload: Record<string, unknown>) =>
                request<Complaint>(`/console/complaints/${id}/assign`, { method: 'POST', body: payload }),
            correct: (id: number, payload: Record<string, unknown>) =>
                request<Complaint>(`/console/complaints/${id}`, { method: 'PATCH', body: payload }),
        },
    },

    // --- The org tree ---
    // Shaping the authority: units are directories, and how many layers a
    // department runs is a setting rather than a migration.
    org: {
        unit: (id: number) => request<import('@/types').OrgUnitDetail>(`/console/units/${id}`),

        createUnit: (payload: {
            parentId: number
            code: string
            name: string
            nameHi?: string
            kindLabel?: string
        }) =>
            request<{ unit: { id: number; name: string; code: string } }>('/console/units', {
                method: 'POST',
                body: payload,
            }),

        updateUnit: (id: number, payload: Record<string, unknown>) =>
            request<{ unit: { id: number } }>(`/console/units/${id}`, {
                method: 'PATCH',
                body: payload,
            }),

        removeUnit: (id: number) =>
            request<{ removed: boolean }>(`/console/units/${id}`, { method: 'DELETE' }),

        layers: (departmentId: number) =>
            request<import('@/types').DepartmentLayersResponse>(
                `/console/departments/${departmentId}/layers`,
            ),

        saveLayers: (
            departmentId: number,
            layers: {
                depth: number
                name: string
                namePlural: string
                canDispatch: boolean
                slaHours: number
                minPostings: number
            }[],
        ) =>
            request<{ layers: import('@/types').DepartmentLayerRow[] }>(
                `/console/departments/${departmentId}/layers`,
                { method: 'PUT', body: { layers } },
            ),
    },

    // --- Notifications ---
    notifications: () =>
        request<{ items: import('@/types').Notification[]; unread: number }>('/notifications'),
    markRead: (id: number) => request<{ updated: number }>(`/notifications/${id}/read`, { method: 'POST' }),
    markAllRead: () => request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
}
