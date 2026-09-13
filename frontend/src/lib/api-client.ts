'use client'

import { ApiError } from './api-error'
import { BROWSER_API, toQuery } from './api-base'
import { uploadForm, type UploadProgress } from './upload'
import type {
    Area,
    AuthResult,
    Board,
    FiledRequest,
    MapCluster,
    NearbyRequest,
    NotificationsPage,
    RequestPhotoMeta,
    NewRequest,
    Paged,
    RequestStatus,
    RequestType,
    ServiceRequest,
    User,
} from '@/types'

/**
 * Browser-side API client.
 *
 * Everything a person *does* — filing, looking up, changing a status, panning
 * the map — goes through here. Most reads happen on the server (see lib/api.ts);
 * this is for mutations and for the panels that fetch as the reader moves.
 *
 * `credentials: 'include'` is load-bearing: the session lives in an httpOnly
 * cookie, so a request without it is anonymous and the server guards would
 * bounce a signed-in agent.
 */

interface RequestOptions {
    method?: string
    body?: unknown
    signal?: AbortSignal
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, signal } = options

    let res: Response
    try {
        res = await fetch(`${BROWSER_API}${path}`, {
            method,
            credentials: 'include',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal,
        })
    } catch (cause) {
        // A dead API and a rejected request are different problems with
        // different fixes, so they get different messages rather than one
        // "something went wrong".
        if (signal?.aborted) throw cause
        throw new ApiError(0, 'Could not reach the service. Check that the API is running.')
    }

    if (!res.ok) {
        let parsed: { error?: string; message?: string } | null = null
        try {
            parsed = await res.json()
        } catch {
            // Non-JSON error body — fall back to the status.
        }
        throw new ApiError(
            res.status,
            parsed?.error ?? parsed?.message ?? `Request failed (${res.status})`,
        )
    }

    if (res.status === 204) return undefined as T
    return (await res.json()) as T
}

export const apiClient = {
    // ---- Session --------------------------------------------------------- //

    login: (email: string, password: string) =>
        request<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }),

    /**
     * Self-registration always produces a citizen — the API decides the role
     * and ignores anything sent for it, so no role is offered here. Agency
     * accounts are seeded, because otherwise anyone could sign themselves into
     * a queue.
     */
    register: (body: {
        name: string
        email: string
        password: string
        phone?: string
        orgUnitId?: number | null
    }) => request<AuthResult>('/auth/register', { method: 'POST', body }),

    logout: () => request<void>('/auth/logout', { method: 'POST', body: {} }),

    me: () => request<User>('/auth/me'),

    updateProfile: (body: { name: string; phone?: string | null; orgUnitId?: number | null }) =>
        request<User>('/auth/me', { method: 'PATCH', body }),

    changePassword: (currentPassword: string, newPassword: string) =>
        request<{ ok: true }>('/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),

    // ---- Notifications ---------------------------------------------------- //

    notifications: () => request<NotificationsPage>('/notifications'),

    markRead: (id: number) => request<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST', body: {} }),

    markAllRead: () => request<{ ok: true; marked: number }>('/notifications/read-all', { method: 'POST', body: {} }),

    // ---- Requests -------------------------------------------------------- //

    file: (body: NewRequest) => request<FiledRequest>('/requests', { method: 'POST', body }),

    /** Photographs of the problem, sent right after filing with the token the filing returned. */
    attachPhotos: (
        srNumber: string,
        photos: File[],
        token: string,
        onProgress?: (progress: UploadProgress) => void,
    ) => {
        const form = new FormData()
        // The token first: multer reads fields in order, and the route checks it.
        form.append('token', token)
        for (const photo of photos) form.append('photos', photo)
        return uploadForm<{ ok: true; count: number }>(
            `${BROWSER_API}/requests/${encodeURIComponent(srNumber)}/photos`,
            form,
            { onProgress },
        )
    },

    photos: (srNumber: string) =>
        request<{ srNumber: string; photos: RequestPhotoMeta[] }>(`/requests/${encodeURIComponent(srNumber)}/photos`),

    nearby: (params: { typeId: number; lat: number; lng: number }, signal?: AbortSignal) =>
        request<{ radiusMetres: number; rows: NearbyRequest[] }>(`/requests/check/nearby${toQuery(params)}`, {
            signal,
        }),

    lookup: (srNumber: string) =>
        request<ServiceRequest>(`/requests/${encodeURIComponent(srNumber)}`),

    page: (params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) =>
        request<Paged<ServiceRequest>>(`/requests${toQuery(params)}`, { signal }),

    mine: () => request<{ rows: ServiceRequest[]; total: number }>('/requests/mine/list'),

    setStatus: (id: number, status: RequestStatus, note?: string) =>
        request<ServiceRequest>(`/requests/${id}/status`, {
            method: 'PATCH',
            body: { status, ...(note ? { note } : {}) },
        }),

    // ---- Reference data --------------------------------------------------- //

    taxonomy: () => request<RequestType[]>('/taxonomy'),

    boards: () => request<Board[]>('/boards'),

    /**
     * Clusters for the current viewport.
     *
     * Deliberately the only map read there is. At 350,000 rows the browser must
     * never be handed the individual points — the cluster arithmetic belongs on
     * the server, where it can run against an index.
     */
    clusters: (
        params: { bbox: string; zoom: number; openOnly?: boolean; typeId?: number; agencyId?: number },
        signal?: AbortSignal,
    ) => request<MapCluster[]>(`/map/clusters${toQuery({ ...params })}`, { signal }),

    areas: () => request<Area[]>('/areas'),
}
