'use client'

import { ApiError } from './api-error'
import type {
    Complaint,
    CrewMember,
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
        homeSectorId?: number | null
    }) => request<{ user: User }>('/auth/register', { method: 'POST', body: payload }),

    logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

    // --- Citizen ---
    fileComplaint: (form: FormData) =>
        request<{ complaint: Complaint; routing: RoutingDecision }>('/complaints', {
            method: 'POST',
            body: form,
        }),

    submitFeedback: (id: number, rating: number, comment?: string) =>
        request<Complaint>(`/complaints/${id}/feedback`, { method: 'POST', body: { rating, comment } }),

    // --- Section Officer ---
    crewFor: (complaintId: number) =>
        request<{ items: CrewMember[]; preferredTrade: string | null; exactTradeAvailable: boolean }>(
            `/officer/complaints/${complaintId}/workers`,
        ),

    allotJob: (complaintId: number, workerId: number, instructions?: string) =>
        request<Complaint>(`/officer/complaints/${complaintId}/allot`, {
            method: 'POST',
            body: { workerId, instructions },
        }),

    verifyWork: (complaintId: number, accept: boolean, note?: string) =>
        request<Complaint>(`/officer/complaints/${complaintId}/verify`, {
            method: 'POST',
            body: { accept, note },
        }),

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

    updateDepartment: (id: number, payload: Record<string, unknown>) =>
        request<Department>(`/departments/${id}`, { method: 'PATCH', body: payload }),

    verifyChain: () =>
        request<{ valid: boolean; checked: number; head?: string; brokenAtId?: number; reason?: string }>(
            '/admin/audit/verify',
        ),

    // --- Notifications ---
    notifications: () =>
        request<{ items: import('@/types').Notification[]; unread: number }>('/notifications'),
    markRead: (id: number) => request<{ updated: number }>(`/notifications/${id}/read`, { method: 'POST' }),
    markAllRead: () => request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
}
