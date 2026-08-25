// Mirrors the Prisma enums in backend/prisma/schema.prisma. Keep in step.

export type UserRole = 'CITIZEN' | 'FIELD_OFFICIAL' | 'ADMIN'

export type ComplaintStatus =
  | 'SUBMITTED'
  | 'ROUTED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REJECTED'
  | 'DUPLICATE'

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type RiskBand = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'
export type RiskEntityType = 'WARD' | 'CONTRACTOR' | 'PROJECT'
export type ReviewStatus = 'PENDING' | 'ACKNOWLEDGED' | 'ACTIONED' | 'DISMISSED'

export interface Ref {
  id: number
  name: string
}

export interface User {
  id: number
  email: string
  fullName: string
  phone: string | null
  role: UserRole
  isActive: boolean
  wardId: number | null
  departmentId: number | null
  ward: { id: number; wardNumber: number; name: string } | null
  department: { id: number; code: string; name: string } | null
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface Ward {
  id: number
  wardNumber: number
  name: string
  zone: string | null
  population: number | null
  centroidLat: number | null
  centroidLon: number | null
}

export interface Department {
  id: number
  code: string
  name: string
  description: string | null
}

export interface Category {
  id: number
  code: string
  name: string
  icon: string
  defaultSlaHours: number
  departmentId: number
  department?: Ref
}

export interface Complaint {
  id: number
  referenceNo: string
  title: string
  description: string
  photoUrl: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
  status: ComplaintStatus
  priority: Priority
  slaDueAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  feedbackRating: number | null
  feedbackComment: string | null
  createdAt: string
  updatedAt: string
  category: { id: number; name: string; icon: string } | null
  department: { id: number; name: string; code: string } | null
  ward: { id: number; wardNumber: number; name: string } | null
  citizen: { id: number; fullName: string; phone: string | null } | null
  assignedTo: { id: number; fullName: string } | null
}

export interface HistoryEntry {
  id: number
  fromStatus: ComplaintStatus | null
  toStatus: ComplaintStatus
  note: string | null
  evidenceUrl: string | null
  createdAt: string
  actor: { id: number; fullName: string; role: UserRole } | null
}

export interface ComplaintDetail extends Complaint {
  history: HistoryEntry[]
}

/** A task is a complaint seen through the assigned official's lens. */
export interface Task extends Complaint {
  isOverdue: boolean
  hoursRemaining: number | null
  nextStatuses: ComplaintStatus[]
}

/** GCCE's decision trace, returned when a complaint is filed. */
export interface RoutingDecision {
  categoryId: number | null
  departmentId: number | null
  wardId: number | null
  assigneeId: number | null
  priority: Priority
  slaDueAt: string | null
  reasons: string[]
  triggered: string[]
}

/** One line of a GRIE explanation. Never render a score without these. */
export interface RiskFactor {
  factor: string
  label: string
  raw: number
  normalised: number
  weight: number
  contribution: number
  explanation: string
}

export interface RiskFlag {
  id: number
  entityType: RiskEntityType
  entityId: number
  entityLabel: string
  score: number
  band: RiskBand
  reason: string
  status: ReviewStatus
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: { id: number; fullName: string } | null
  createdAt: string
  updatedAt: string
  factors: RiskFactor[]
}

export interface WardRisk {
  wardId: number
  wardNumber: number
  name: string
  zone: string | null
  score: number | null
  band: RiskBand | null
  factors: RiskFactor[]
  computedAt: string | null
}

export interface RiskDetail {
  entityType: RiskEntityType
  entityId: number
  score: number
  band: RiskBand
  factors: RiskFactor[]
  modelVersion: string
  computedAt: string
  signals: Record<string, number>
  weights: { factor: string; label: string; weight: number }[]
  history: { score: number; band: RiskBand; computedAt: string }[]
}

export interface ComplaintStats {
  byStatus: Record<ComplaintStatus, number>
  total: number
  open: number
  resolved: number
  overdue: number
}

export interface AdminStats {
  complaints: {
    total: number
    open: number
    overdue: number
    resolved: number
    byStatus: Record<ComplaintStatus, number>
  }
  pendingFlags: number
  people: { citizens: number; officials: number }
  departmentBreakdown: { departmentId: number; name: string; count: number }[]
  avgResolutionDays: number | null
}

export interface Notification {
  id: number
  title: string
  body: string
  link: string | null
  isRead: boolean
  createdAt: string
}

export interface AuditEvent {
  id: number
  actorId: number | null
  actorLabel: string | null
  action: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  source: string
  prevHash: string | null
  hash: string
  createdAt: string
}

export interface ChainResult {
  valid: boolean
  checked: number
  head?: string
  brokenAtId?: number
  reason?: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  size: number
}
