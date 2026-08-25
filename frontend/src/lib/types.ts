// Mirrors the Prisma enums in backend/prisma/schema.prisma. Keep in step.

/** Ordered by seniority. RANK_LEVEL in format.ts holds the numeric mapping. */
export type Rank =
  | 'CITIZEN'
  | 'FIELD_WORKER'
  | 'SECTION_OFFICER'
  | 'CIRCLE_OFFICER'
  | 'ZONAL_OFFICER'
  | 'HOD'
  | 'CEO'
  | 'SUPER_ADMIN'

export type JurisdictionLevel = 'AUTHORITY' | 'ZONE' | 'CIRCLE' | 'SECTOR'

export type Trade =
  | 'SAFAI_KARAMCHARI'
  | 'LINEMAN'
  | 'BELDAR'
  | 'MASON'
  | 'PLUMBER'
  | 'MALI'
  | 'DRIVER'

export type DepartmentStatus = 'ACTIVE' | 'COMING_SOON'

export type ComplaintStatus =
  | 'SUBMITTED'
  | 'ROUTED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'AWAITING_VERIFICATION'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REJECTED'
  | 'DUPLICATE'

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type RiskBand = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'
export type RiskEntityType = 'SECTOR' | 'CIRCLE' | 'ZONE' | 'DEPARTMENT' | 'CONTRACTOR' | 'PROJECT'
export type ReviewStatus = 'PENDING' | 'ACKNOWLEDGED' | 'ACTIONED' | 'DISMISSED'

// --- Geography ---------------------------------------------------------------

export interface Zone {
  id: number
  code: string
  name: string
  nameHi: string | null
}

export interface Circle {
  id: number
  code: string
  name: string
  zoneId: number
}

export interface Sector {
  id: number
  number: number
  name: string
  circleId: number
  population: number | null
  centroidLat: number | null
  centroidLon: number | null
  circle?: Circle & { zone?: Zone }
}

export interface GeographyTree extends Zone {
  circles: (Circle & { sectors: Sector[] })[]
}

// --- Organisation ------------------------------------------------------------

export interface Designation {
  id: number
  rank: Rank
  title: string
  shortTitle: string | null
}

export interface Department {
  id: number
  code: string
  name: string
  nameHi: string | null
  description: string | null
  icon: string
  status: DepartmentStatus
  roadmapNote: string | null
  sortOrder: number
  designations?: Designation[]
  _count?: { categories: number; postings: number; complaints: number }
}

export interface Posting {
  id: number
  rank: Rank
  level: JurisdictionLevel
  designationTitle: string | null
  trade: Trade | null
  employeeCode: string | null
  isPrimary: boolean
  department: { id: number; code: string; name: string; icon: string } | null
  zone: { id: number; code: string; name: string } | null
  circle: { id: number; code: string; name: string } | null
  sector: { id: number; number: number; name: string } | null
}

export interface User {
  id: number
  email: string
  fullName: string
  phone: string | null
  rank: Rank
  isActive: boolean
  homeSectorId: number | null
  homeSector: { id: number; number: number; name: string } | null
  postings: Posting[]
  /** The posting the UI leads with. */
  primaryPosting: Posting | null
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface OrgTier {
  rank: Rank
  label: string
  designation: string
  count: number
  people: (Posting & {
    user: { id: number; fullName: string; email: string; phone: string | null; isActive: boolean }
    jurisdictionLabel: string
  })[]
}

export interface OrgChart {
  department: Pick<Department, 'id' | 'code' | 'name' | 'nameHi' | 'icon' | 'status'>
  tiers: OrgTier[]
  totalStaff: number
}

export interface Category {
  id: number
  code: string
  name: string
  nameHi: string | null
  icon: string
  trade: Trade | null
  defaultSlaHours: number
  departmentId: number
  department?: { id: number; name: string; code: string; icon: string }
}

// --- Complaints --------------------------------------------------------------

export interface Complaint {
  id: number
  referenceNo: string
  title: string
  description: string
  photoUrl: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
  landmark: string | null
  status: ComplaintStatus
  priority: Priority
  slaDueAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  escalationLevel: number
  feedbackRating: number | null
  feedbackComment: string | null
  createdAt: string
  updatedAt: string
  category: { id: number; name: string; icon: string; trade: Trade | null } | null
  department: { id: number; name: string; code: string; icon: string } | null
  sector: {
    id: number
    number: number
    name: string
    circle: { id: number; name: string; zone: { id: number; name: string } | null } | null
  } | null
  citizen: { id: number; fullName: string; phone: string | null } | null
  assignedOfficer: { id: number; fullName: string; rank: Rank } | null
  assignedWorker: { id: number; fullName: string } | null
}

export interface HistoryEntry {
  id: number
  fromStatus: ComplaintStatus | null
  toStatus: ComplaintStatus
  note: string | null
  evidenceUrl: string | null
  createdAt: string
  actor: { id: number; fullName: string; rank: Rank } | null
}

export interface EscalationEntry {
  id: number
  fromRank: Rank
  toRank: Rank
  reason: string
  hoursOverdue: number
  createdAt: string
  toUser: { id: number; fullName: string } | null
}

export interface ComplaintDetail extends Complaint {
  history: HistoryEntry[]
  escalations: EscalationEntry[]
}

/** A complaint on a Section Officer's desk. */
export interface DeskItem extends Complaint {
  isOverdue: boolean
  hoursRemaining: number | null
  nextStatuses: ComplaintStatus[]
  /** True when GCCE has assigned it but no worker is on the job yet. */
  needsAllotment: boolean
}

/** The trimmed shape a field worker's phone receives. */
export interface Job {
  id: number
  referenceNo: string
  title: string
  description: string
  photoUrl: string | null
  address: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  status: ComplaintStatus
  priority: Priority
  slaDueAt: string | null
  createdAt: string
  category: { name: string; nameHi: string | null; icon: string } | null
  sector: { id: number; number: number; name: string } | null
  /** The Section Officer for this sector — who the worker actually reports to. */
  supervisor: { id: number; fullName: string; designationTitle: string | null } | null
  isOverdue: boolean
  hoursRemaining: number | null
}

export interface CrewMember {
  userId: number
  fullName: string
  trade: Trade | null
  designationTitle: string | null
  employeeCode: string | null
  activeJobs: number
}

/** GCCE's decision trace, returned when a complaint is filed. */
export interface RoutingDecision {
  categoryId: number | null
  departmentId: number | null
  sectorId: number | null
  assignedOfficerId: number | null
  priority: Priority
  slaDueAt: string | null
  reasons: string[]
  triggered: string[]
}

export interface MapPin {
  id: number
  referenceNo: string
  title: string
  latitude: number
  longitude: number
  status: ComplaintStatus
  priority: Priority
  slaDueAt: string | null
  escalationLevel: number
  category: { name: string; icon: string } | null
  sector: { id: number; number: number; name: string } | null
  department: { id: number; name: string; icon: string } | null
}

// --- GRIE --------------------------------------------------------------------

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

export interface SectorRisk {
  sectorId: number
  number: number
  name: string
  circle: string
  zone: string
  centroidLat: number | null
  centroidLon: number | null
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

// --- Dashboards --------------------------------------------------------------

export interface ComplaintStats {
  byStatus: Record<ComplaintStatus, number>
  total: number
  open: number
  resolved: number
  overdue: number
  escalated: number
}

export interface OversightStats {
  viewer: {
    rank: Rank
    rankLabel: string
    designationTitle: string | null
    scopeLabel: string
  }
  complaints: {
    total: number
    open: number
    overdue: number
    escalated: number
    resolved: number
    awaitingVerification: number
    byStatus: Record<ComplaintStatus, number>
  }
  pendingFlags: number
  people: { citizens: number; officers: number; workers: number }
  departmentBreakdown: { departmentId: number; name: string; icon: string; count: number }[]
  avgResolutionDays: number | null
}

export interface SectorPerformance {
  sectorId: number
  number: number
  name: string
  circle: string
  zone: string
  total: number
  open: number
  overdue: number
  escalated: number
}

export interface EscalationInboxItem {
  id: number
  reason: string
  hoursOverdue: number
  fromRank: Rank
  fromRankLabel: string
  toRank: Rank
  acknowledgedAt: string | null
  createdAt: string
  complaint: {
    id: number
    referenceNo: string
    title: string
    status: ComplaintStatus
    priority: Priority
    slaDueAt: string | null
    category: { name: string; icon: string } | null
    department: { name: string } | null
    sector: { number: number; name: string } | null
  }
}

// --- Platform ----------------------------------------------------------------

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
