import type { TokenPair, User } from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'

const ACCESS_KEY = 'drishti.access'
const REFRESH_KEY = 'drishti.refresh'

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Pull a readable message out of FastAPI's error shapes.
 *  `detail` is a string for our own HTTPExceptions but an array of objects for
 *  pydantic validation failures, and rendering "[object Object]" at the user is
 *  worse than useless. */
function extractMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((d) => (typeof d === 'object' && d && 'msg' in d ? String(d.msg) : String(d)))
        .join('; ')
    }
  }
  return `Request failed with status ${status}`
}

let refreshInFlight: Promise<boolean> | null = null

/** Swap the refresh token for a new access token.
 *  Concurrent 401s share one in-flight refresh, so a page that fires several
 *  requests at once doesn't burn several refreshes and race. */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const refresh = tokenStore.refresh
    if (!refresh) return false
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) return false
      const data = (await res.json()) as { access_token: string }
      tokenStore.set(data.access_token)
      return true
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
  auth?: boolean
  /** Internal: stops a refreshed request from retrying forever. */
  _retried?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, _retried = false } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && auth && !_retried) {
    if (await refreshAccessToken()) {
      return request<T>(path, { ...options, _retried: true })
    }
    tokenStore.clear()
  }

  if (!res.ok) {
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      // Non-JSON error body (a proxy error page, say) - fall back to the status.
    }
    throw new ApiError(res.status, extractMessage(parsed, res.status))
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  login: (email: string, password: string) =>
    request<TokenPair>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  register: (payload: {
    email: string
    password: string
    full_name: string
    phone?: string
    ward_id?: number | null
  }) =>
    request<TokenPair>('/auth/register', { method: 'POST', body: payload, auth: false }),

  me: () => request<User>('/auth/me'),

  wards: () => request<import('./types').Ward[]>('/wards'),

  departments: () => request<import('./types').Department[]>('/departments'),

  health: () => request<Record<string, unknown>>('/health', { auth: false }),
}
