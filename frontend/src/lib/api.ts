import type {
  AdminStats,
  AuditEvent,
  AuthResponse,
  Category,
  ChainResult,
  Complaint,
  ComplaintDetail,
  ComplaintStats,
  Department,
  Notification,
  Paged,
  RiskDetail,
  RiskEntityType,
  RiskFlag,
  RoutingDecision,
  Task,
  User,
  Ward,
  WardRisk,
} from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1'

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
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let refreshInFlight: Promise<boolean> | null = null

/**
 * Exchange the refresh token for a new access token.
 *
 * Concurrent 401s share one in-flight refresh, so a page firing several requests
 * at once does not burn several refreshes and race.
 */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const refreshToken = tokenStore.refresh
    if (!refreshToken) return false
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return false
      const data = (await res.json()) as { accessToken: string }
      tokenStore.set(data.accessToken)
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
  retried?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retried = false } = options

  const headers: Record<string, string> = {}
  const isFormData = body instanceof FormData
  // Let the browser set the multipart boundary itself; forcing a Content-Type
  // here would produce a header without one and the upload would fail to parse.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json'
  if (auth && tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  })

  if (res.status === 401 && auth && !retried) {
    if (await refreshAccessToken()) return request<T>(path, { ...options, retried: true })
    tokenStore.clear()
  }

  if (!res.ok) {
    let parsed: { error?: string; details?: unknown } | null = null
    try {
      parsed = await res.json()
    } catch {
      // A non-JSON error body (a proxy page, say) — fall back to the status.
    }
    throw new ApiError(
      res.status,
      parsed?.error ?? `Request failed (${res.status})`,
      parsed?.details,
    )
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

export const api = {
  // --- Auth ---
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  register: (payload: {
    email: string
    password: string
    fullName: string
    phone?: string
    wardId?: number | null
  }) => request<AuthResponse>('/auth/register', { method: 'POST', body: payload, auth: false }),

  me: () => request<User>('/auth/me'),

  // --- Reference data ---
  wards: () => request<Ward[]>('/wards'),
  departments: () => request<Department[]>('/departments'),
  categories: () => request<Category[]>('/categories'),

  // --- Complaints ---
  fileComplaint: (form: FormData) =>
    request<{ complaint: Complaint; routing: RoutingDecision }>('/complaints', {
      method: 'POST',
      body: form,
    }),

  complaints: (params: { status?: string; q?: string; wardId?: number; page?: number; size?: number } = {}) =>
    request<Paged<Complaint>>(`/complaints${qs(params)}`),

  complaint: (id: number) => request<ComplaintDetail>(`/complaints/${id}`),

  complaintStats: () => request<ComplaintStats>('/complaints/stats'),

  submitFeedback: (id: number, rating: number, comment?: string) =>
    request<Complaint>(`/complaints/${id}/feedback`, { method: 'POST', body: { rating, comment } }),

  closeComplaint: (id: number, note?: string) =>
    request<Complaint>(`/complaints/${id}/close`, { method: 'POST', body: { note } }),

  // --- Tasks (field official) ---
  tasks: (scope: 'active' | 'all' | 'done' = 'active') =>
    request<{ items: Task[]; total: number }>(`/tasks${qs({ scope })}`),

  updateTaskStatus: (id: number, form: FormData) =>
    request<Complaint>(`/tasks/${id}/status`, { method: 'POST', body: form }),

  // --- GRIE ---
  riskQueue: (status = 'PENDING') =>
    request<{ items: RiskFlag[]; total: number; threshold: number }>(`/risk/queue${qs({ status })}`),

  wardRisk: () => request<{ items: WardRisk[]; threshold: number }>('/risk/wards'),

  riskDetail: (entityType: RiskEntityType, entityId: number) =>
    request<RiskDetail>(`/risk/${entityType}/${entityId}`),

  reviewFlag: (id: number, status: string, note?: string) =>
    request<RiskFlag>(`/risk/flags/${id}/review`, { method: 'POST', body: { status, note } }),

  recomputeRisk: () => request<{ recomputed: unknown }>('/risk/recompute', { method: 'POST' }),

  // --- Notifications ---
  notifications: () => request<{ items: Notification[]; unread: number }>('/notifications'),
  markRead: (id: number) => request<{ updated: number }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),

  // --- Admin ---
  adminStats: () => request<AdminStats>('/admin/stats'),

  users: (params: { role?: string; q?: string; page?: number } = {}) =>
    request<Paged<User>>(`/admin/users${qs(params)}`),

  createUser: (payload: Record<string, unknown>) =>
    request<User>('/admin/users', { method: 'POST', body: payload }),

  updateUser: (id: number, payload: Record<string, unknown>) =>
    request<User>(`/admin/users/${id}`, { method: 'PATCH', body: payload }),

  auditTrail: (params: { entityType?: string; action?: string; page?: number; size?: number } = {}) =>
    request<Paged<AuditEvent>>(`/admin/audit${qs(params)}`),

  verifyChain: () => request<ChainResult>('/admin/audit/verify'),
}
