import type {
  AuditEvent,
  AuthResponse,
  Category,
  ChainResult,
  Complaint,
  ComplaintDetail,
  ComplaintStats,
  CrewMember,
  Department,
  DeskItem,
  EscalationInboxItem,
  GeographyTree,
  Job,
  MapPin,
  Notification,
  OrgChart,
  OversightStats,
  Paged,
  Rank,
  RiskDetail,
  RiskEntityType,
  RiskFlag,
  RoutingDecision,
  Sector,
  SectorPerformance,
  SectorRisk,
  Trade,
  User,
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
    homeSectorId?: number | null
  }) => request<AuthResponse>('/auth/register', { method: 'POST', body: payload, auth: false }),

  me: () => request<User>('/auth/me'),

  // --- Reference data ---
  geography: () => request<GeographyTree[]>('/geography'),
  sectors: () => request<Sector[]>('/sectors'),
  departments: () => request<Department[]>('/departments'),
  categories: () => request<Category[]>('/categories'),
  ranks: () =>
    request<{ rank: Rank; level: number; label: string; jurisdiction: string }[]>('/ranks'),
  trades: () => request<{ trade: Trade; label: string }[]>('/trades'),
  orgChart: (departmentId: number) => request<OrgChart>(`/departments/${departmentId}/chart`),
  sectorStaff: (sectorId: number) =>
    request<{ sector: unknown; staff: unknown[] }>(`/sectors/${sectorId}/staff`),

  // --- Complaints (citizen + shared) ---
  fileComplaint: (form: FormData) =>
    request<{ complaint: Complaint; routing: RoutingDecision }>('/complaints', {
      method: 'POST',
      body: form,
    }),

  complaints: (
    params: {
      status?: string
      sectorId?: number
      departmentId?: number
      scope?: 'mine' | 'jurisdiction' | 'all'
      q?: string
      page?: number
      size?: number
    } = {},
  ) => request<Paged<Complaint>>(`/complaints${qs(params)}`),

  complaint: (id: number) => request<ComplaintDetail>(`/complaints/${id}`),
  complaintStats: () => request<ComplaintStats>('/complaints/stats'),
  mapPins: (params: { status?: 'open' | 'all'; departmentId?: number } = {}) =>
    request<{ items: MapPin[]; total: number }>(`/complaints/map${qs(params)}`),

  submitFeedback: (id: number, rating: number, comment?: string) =>
    request<Complaint>(`/complaints/${id}/feedback`, { method: 'POST', body: { rating, comment } }),

  closeComplaint: (id: number, note?: string) =>
    request<Complaint>(`/complaints/${id}/close`, { method: 'POST', body: { note } }),

  // --- Section Officer's desk ---
  desk: (scope: 'active' | 'awaiting' | 'done' = 'active') =>
    request<{ items: DeskItem[]; total: number }>(`/officer/desk${qs({ scope })}`),

  crewFor: (complaintId: number) =>
    request<{ items: CrewMember[]; preferredTrade: Trade | null; exactTradeAvailable: boolean }>(
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

  disposeComplaint: (complaintId: number, form: FormData) =>
    request<Complaint>(`/officer/complaints/${complaintId}/dispose`, { method: 'POST', body: form }),

  // --- Field worker ---
  jobs: (scope: 'active' | 'done' = 'active') =>
    request<{ items: Job[]; total: number }>(`/worker/jobs${qs({ scope })}`),

  job: (id: number) => request<Job>(`/worker/jobs/${id}`),

  completeJob: (id: number, form: FormData) =>
    request<{ id: number; status: string; evidenceUrl: string; message: string }>(
      `/worker/jobs/${id}/complete`,
      { method: 'POST', body: form },
    ),

  reportJobIssue: (id: number, form: FormData) =>
    request<{ id: number; message: string }>(`/worker/jobs/${id}/report-issue`, {
      method: 'POST',
      body: form,
    }),

  // --- GRIE ---
  riskQueue: (status = 'PENDING') =>
    request<{ items: RiskFlag[]; total: number; threshold: number }>(`/risk/queue${qs({ status })}`),

  sectorRisk: () => request<{ items: SectorRisk[]; threshold: number }>('/risk/sectors'),

  riskDetail: (entityType: RiskEntityType, entityId: number) =>
    request<RiskDetail>(`/risk/${entityType}/${entityId}`),

  reviewFlag: (id: number, status: string, note?: string) =>
    request<RiskFlag>(`/risk/flags/${id}/review`, { method: 'POST', body: { status, note } }),

  recomputeRisk: () => request<{ recomputed: unknown }>('/risk/recompute', { method: 'POST' }),

  // --- Oversight ---
  oversightStats: () => request<OversightStats>('/admin/stats'),
  sectorPerformance: () => request<{ items: SectorPerformance[] }>('/admin/sector-performance'),
  escalationInbox: () =>
    request<{ items: EscalationInboxItem[]; total: number }>('/admin/escalations'),
  acknowledgeEscalation: (id: number) =>
    request<unknown>(`/admin/escalations/${id}/acknowledge`, { method: 'POST' }),
  runEscalationSweep: () =>
    request<{ checked: number; escalated: unknown[] }>('/admin/escalations/sweep', {
      method: 'POST',
    }),

  // --- Super Admin ---
  users: (params: { rank?: string; departmentId?: number; sectorId?: number; q?: string; page?: number } = {}) =>
    request<Paged<User>>(`/admin/users${qs(params)}`),

  updateUser: (id: number, payload: Record<string, unknown>) =>
    request<User>(`/admin/users/${id}`, { method: 'PATCH', body: payload }),

  createStaff: (payload: Record<string, unknown>) =>
    request<User>('/staff', { method: 'POST', body: payload }),

  transferStaff: (id: number, payload: Record<string, unknown>) =>
    request<User>(`/staff/${id}/transfer`, { method: 'POST', body: payload }),

  updateDepartment: (id: number, payload: Record<string, unknown>) =>
    request<Department>(`/departments/${id}`, { method: 'PATCH', body: payload }),

  // --- Notifications ---
  notifications: () => request<{ items: Notification[]; unread: number }>('/notifications'),
  markRead: (id: number) => request<{ updated: number }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),

  // --- Audit ---
  auditTrail: (params: { entityType?: string; action?: string; page?: number; size?: number } = {}) =>
    request<Paged<AuditEvent>>(`/admin/audit${qs(params)}`),

  verifyChain: () => request<ChainResult>('/admin/audit/verify'),
}
