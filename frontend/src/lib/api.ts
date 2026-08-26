import { cookies } from 'next/headers'
import { ApiError } from './api-error'

/**
 * Server-side API client.
 *
 * Server components cannot read localStorage, so every request forwards the
 * caller's own session cookie to the API. That is what lets a layout guard a
 * whole role on the server and a page arrive already holding its data, instead
 * of every screen flashing a spinner while the browser fetches.
 *
 * Use `apiClient` from a client component; this module is server-only.
 */

const BASE_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1'

interface ServerFetchOptions {
    method?: string
    body?: unknown
    /** Seconds to cache. Defaults to no caching — governance data goes stale fast. */
    revalidate?: number
}

export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
    const { method = 'GET', body, revalidate } = options

    const cookieHeader = cookies()
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join('; ')

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
    })

    if (!res.ok) {
        let parsed: { error?: string } | null = null
        try {
            parsed = await res.json()
        } catch {
            // Non-JSON error body — fall back to the status.
        }
        throw new ApiError(res.status, parsed?.error ?? `Request failed (${res.status})`)
    }

    if (res.status === 204) return undefined as T
    return (await res.json()) as T
}

/**
 * Fetch that returns a fallback instead of throwing.
 *
 * A dashboard assembles half a dozen independent panels; one failing endpoint
 * should leave the rest of the page standing rather than blanking it.
 */
export async function serverFetchOr<T>(path: string, fallback: T): Promise<T> {
    try {
        return await serverFetch<T>(path)
    } catch {
        return fallback
    }
}
