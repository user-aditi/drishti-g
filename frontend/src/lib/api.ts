import { cookies } from 'next/headers'
import { ApiError } from './api-error'
import { SERVER_API, toQuery } from './api-base'
import type {
    Area,
    AuditVerification,
    Board,
    Health,
    MapCluster,
    NotificationsPage,
    Paged,
    RequestDetail,
    RequestProgress,
    RequestType,
    ServiceRequest,
    User,
} from '@/types'

/**
 * Server-side API client.
 *
 * Server components cannot read the browser's storage, so every request
 * forwards the caller's own session cookie. That is what lets a layout guard a
 * whole role on the server and a page arrive already holding its rows, instead
 * of every screen flashing a spinner while the browser fetches — which matters
 * most on the register, where the first paint is the whole experience.
 *
 * Use `apiClient` from a client component; this module is server-only.
 */

interface ServerFetchOptions {
    method?: string
    body?: unknown
    /** Seconds to cache. Defaults to none — a queue goes stale in seconds. */
    revalidate?: number
}

export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
    const { method = 'GET', body, revalidate } = options

    const cookieHeader = cookies()
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join('; ')

    const res = await fetch(`${SERVER_API}${path}`, {
        method,
        headers: {
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
    })

    if (!res.ok) {
        let parsed: { error?: string; message?: string } | null = null
        try {
            parsed = await res.json()
        } catch {
            // Non-JSON error body — fall back to the status.
        }
        throw new ApiError(res.status, parsed?.error ?? parsed?.message ?? `Request failed (${res.status})`)
    }

    if (res.status === 204) return undefined as T
    return (await res.json()) as T
}

// ---- Reads a server component actually performs -------------------------- //

export const getSession = () => serverFetch<User>('/auth/me')

export const getTaxonomy = () =>
    // The six complaint types change only when the dataset is rebuilt, so this
    // is the one read worth caching — every filter dropdown in the app wants it.
    serverFetch<RequestType[]>('/taxonomy', { revalidate: 300 })

export const getBoards = (agencyId?: number) =>
    serverFetch<Board[]>(`/boards${agencyId ? `?agencyId=${agencyId}` : ''}`, { revalidate: 60 })

export const getAreas = () => serverFetch<Area[]>('/areas', { revalidate: 300 })

/**
 * One request, by the number on it.
 *
 * The SR number is the only handle the API exposes for a single request, and
 * that is not an oversight — it is the credential a person who filed by
 * telephone actually holds. The agent's detail screen uses the same lookup, so
 * both views are reading the same record rather than two shapes of it.
 */
export const getRequestBySrNumber = (srNumber: string) =>
    serverFetch<RequestDetail>(`/requests/${encodeURIComponent(srNumber)}`)

export const getRequestPage = (params: Record<string, string | number | boolean | undefined>) =>
    serverFetch<Paged<ServiceRequest>>(`/requests${toQuery(params)}`)

export const getMyRequests = () =>
    serverFetch<{ rows: ServiceRequest[]; total: number }>('/requests/mine/list')

export const getClusters = (params: { bbox: string; zoom: number; openOnly?: boolean }) =>
    serverFetch<MapCluster[]>(`/map/clusters${toQuery({ ...params })}`)

export const verifyAudit = () => serverFetch<AuditVerification>('/audit/verify')

/** Carries the reference date the whole system reads "overdue" against. */
export const getHealth = () => serverFetch<Health>('/health')

export const getProgress = (srNumber: string) =>
    serverFetch<RequestProgress>(`/requests/${encodeURIComponent(srNumber)}/progress`)

export const getNotifications = () => serverFetch<NotificationsPage>('/notifications')

export const getUnreadCount = () => serverFetch<{ unread: number }>('/notifications/unread-count')
