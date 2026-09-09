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
/**
 * What GRIE scores. `ORG_UNIT` covers any layer of the tree — a sector, a zone,
 * the whole city — because scoring an area does not change with its depth.
 * SECTOR / CIRCLE / ZONE remain only for historical rows.
 *
 * CONTRACTOR and PROJECT are deliberately absent: works management left the
 * product, and the API no longer serves a flag or a score for either, so the
 * screens have no case to render.
 */
export type RiskEntityType =
  | 'ORG_UNIT'
  | 'DEPARTMENT'
  | 'SECTOR'
  | 'CIRCLE'
  | 'ZONE'
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
  /** The ground-floor unit they live in. Supersedes homeSectorId. */
  homeUnitId: number | null
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

/** One step up the org tree. Null labels mean a historical row from before the tree. */
/** A ground-floor area a resident can say they live in. */
export interface Area {
  id: number
  name: string
  code: string
  kindLabel: string
}

/** A unit on the org tree, as referenced from other records. */
export interface OrgUnitRef {
  id: number
  name: string
  kindLabel: string
  depth?: number
}

export interface EscalationEntry {
  id: number
  fromLabel: string | null
  toLabel: string | null
  reason: string
  hoursOverdue: number
  createdAt: string
  toUser: { id: number; fullName: string } | null
}

/**
 * How long this kind of work has actually taken here.
 *
 * `basis` says which bucket the estimate came from, and therefore how specific
 * a claim the wording may make — the API sends a ready-made `sentence` so the
 * decision is made once, server-side, rather than re-derived by every screen
 * that shows it.
 */
export interface SlaEstimate {
  /** Hours. What usually happens. */
  p50: number
  /** Hours. The commitment the deadline is set from. */
  p90: number
  basis: 'unit+priority' | 'unit' | 'category' | 'default'
  /** Resolutions behind it; 0 when nothing has been learned yet. */
  support: number
  sentence: string
}

export interface ComplaintDetail extends Complaint {
  slaEstimate: SlaEstimate | null
  history: HistoryEntry[]
  escalations: EscalationEntry[]
  /** Whether neighbours may back this, and who already has. */
  isCommunity: boolean
  supporters: number
  viewerHasSupported: boolean
  viewerCanSupport: boolean
  nextThreshold: SupportThreshold | null
  supportList: SupportEntry[]
  /** True only while a crew's submission is waiting on this citizen's verdict. */
  awaitingMyConfirmation: boolean
  workProof: WorkProofView | null
  citizenConfirmed: boolean | null
  citizenProofUrl: string | null
}

/** A complaint on a Section Officer's desk. */
export interface DeskItem extends Complaint {
  isOverdue: boolean
  hoursRemaining: number | null
  nextStatuses: ComplaintStatus[]
  /** True when it is with this officer and no code is out in the field yet. */
  needsAllotment: boolean
  /** The job currently out with a crew, if there is one. */
  activeWorkOrder: ActiveWorkOrder | null
  /** The computed urgency, and the working behind it. */
  priorityScore: number | null
  priorityFactors: PriorityFactor[] | null
  cluster: ClusterRef | null
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
  fromUnit: OrgUnitRef | null
  toUnit: OrgUnitRef | null
  fromLabel: string | null
  toLabel: string | null
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

// --- Super Admin control room ------------------------------------------------
//
// The console sees the whole platform rather than one jurisdiction, so its
// shapes carry the counts and cross-references the scoped views leave out.

export interface ConsoleOverview {
  registers: {
    zones: number
    circles: number
    sectors: number
    departments: number
    activeDepartments: number
    designations: number
    categories: number
    activeCategories: number
    staff: number
    inactiveStaff: number
    citizens: number
    postings: number
    complaints: number
    contractors: number
    projects: number
    inspections: number
    auditEvents: number
  }
  attention: {
    openComplaints: number
    overdue: number
    unrouted: number
    pendingFlags: number
    blacklistedContractors: number
    /** Live departments with no Section Officer — complaints would route nowhere. */
    unstaffedDepartments: { id: number; name: string; icon: string }[]
    /** Sectors no Section Officer covers, in any department. */
    uncoveredSectors: { id: number; number: number; name: string }[]
  }
}

export interface ZoneRow {
  id: number
  code: string
  name: string
  nameHi: string | null
  circleCount: number
  staffCount: number
}

export interface CircleRow {
  id: number
  code: string
  name: string
  zoneId: number
  zoneName: string
  sectorCount: number
  staffCount: number
}

export interface SectorRow {
  id: number
  number: number
  name: string
  circleId: number
  circleName: string
  zoneId: number
  zoneName: string
  population: number | null
  centroidLat: number | null
  centroidLon: number | null
  complaintCount: number
  staffCount: number
  residentCount: number
}

export interface GeographyRows {
  zones: ZoneRow[]
  circles: CircleRow[]
  sectors: SectorRow[]
}

export interface DesignationRow {
  id: number
  departmentId: number
  department: { id: number; name: string; code: string; icon: string }
  rank: Rank
  rankLabel: string
  title: string
  titleHi: string | null
  shortTitle: string | null
  /** People currently holding this post. Renaming an occupied post is visible. */
  holders: number
}

export interface CategoryRow {
  id: number
  code: string
  name: string
  nameHi: string | null
  icon: string
  departmentId: number
  department: { id: number; name: string; code: string; icon: string; status: DepartmentStatus }
  defaultSlaHours: number
  keywords: string
  trade: Trade | null
  isActive: boolean
  sortOrder: number
  complaintCount: number
}

export interface StaffRow extends User {
  rankLabel: string
  openCases: number
  openJobs: number
  lifetimeCases: number
  filedComplaints: number
}

export interface StaffFile extends User {
  rankLabel: string
  /** Every posting they have ever held, current first. */
  postingHistory: (Posting & { startedAt: string; endedAt: string | null })[]
  openCases: number
  openJobs: number
  recentWork: Complaint[]
}

export interface ConsoleComplaint extends Complaint {
  isOverdue: boolean
}

/** An official a complaint could be handed to, ranked by fit. */
export interface AssignCandidate {
  id: number
  fullName: string
  email: string
  rank: Rank
  rankLabel: string
  designationTitle: string
  department: { id: number; name: string; icon: string } | null
  jurisdictionLabel: string
  openCases: number
  inJurisdiction: boolean
  sameDepartment: boolean
  /** Why this person is a plausible owner, in the order they should be read. */
  reasons: string[]
  fit: number
}

export interface ContractorRow {
  id: number
  code: string
  name: string
  registrationNo: string | null
  contactEmail: string | null
  isBlacklisted: boolean
  projectCount: number
  budgetAllocated: number
  budgetSpent: number
  createdAt: string
}

export interface ProjectRow {
  id: number
  code: string
  name: string
  description: string | null
  contractor: { id: number; name: string; isBlacklisted: boolean } | null
  department: { id: number; name: string; icon: string } | null
  sector: { id: number; number: number; name: string } | null
  budgetAllocated: number | null
  budgetSpent: number | null
  /** Money spent as a share of money allocated, to read against completion. */
  burnPct: number | null
  completionPct: number | null
  plannedStart: string | null
  plannedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  inspectionCount: number
  isOverdue: boolean
}

export interface InspectionRow {
  id: number
  projectId: number
  inspectorId: number | null
  inspector: { id: number; fullName: string; rank: Rank } | null
  scheduledFor: string | null
  conductedOn: string | null
  passed: boolean | null
  score: number | null
  remarks: string | null
  createdAt: string
}

// --- Drill-down -------------------------------------------------------------
//
// Each of these is "one record and what sits under it". They are what let a
// page be an entity with its children rather than a list to cross-reference.

/** Complaint health for one slice of the city or the organisation. */
export interface ComplaintTally {
  total: number
  open: number
  overdue: number
  /** Open, but nobody is accountable — the number that should always be zero. */
  unassigned: number
}

/** One person on a roster, wherever that roster is drawn from. */
export interface RosterRow {
  postingId: number
  userId: number
  fullName: string
  email: string
  isActive: boolean
  rank: Rank
  rankLabel: string
  designationTitle: string
  department: { id: number; name: string; icon: string } | null
  trade: Trade | null
  employeeCode: string | null
  jurisdictionLabel: string
  openCases: number
}

export interface ZoneDetail {
  zone: { id: number; code: string; name: string; nameHi: string | null }
  circles: { id: number; code: string; name: string; sectorCount: number; staffCount: number }[]
  sectorCount: number
  staff: RosterRow[]
  complaints: ComplaintTally
  projectCount: number
}

export interface CircleDetail {
  circle: {
    id: number
    code: string
    name: string
    zone: { id: number; name: string }
  }
  sectors: {
    id: number
    number: number
    name: string
    population: number | null
    complaintCount: number
    staffCount: number
  }[]
  staff: RosterRow[]
  complaints: ComplaintTally
  projectCount: number
}

export interface SectorProject {
  id: number
  code: string
  name: string
  contractor: { id: number; name: string; isBlacklisted: boolean } | null
  department: { id: number; name: string; icon: string } | null
  budgetAllocated: number | null
  budgetSpent: number | null
  burnPct: number | null
  completionPct: number | null
  plannedEnd: string | null
  actualEnd: string | null
  inspectionCount: number
  isOverdue: boolean
}

export interface SectorDetail {
  sector: {
    id: number
    number: number
    name: string
    population: number | null
    centroidLat: number | null
    centroidLon: number | null
    circle: { id: number; name: string }
    zone: { id: number; name: string }
  }
  staff: RosterRow[]
  complaints: ComplaintTally
  residentCount: number
  risk: { score: number; band: RiskBand; factors: RiskFactor[]; computedAt: string } | null
  projects: SectorProject[]
}

export interface DepartmentDetail {
  department: Department
  /** The chain of command inside this department, senior first. */
  tiers: { rank: Rank; rankLabel: string; designation: string; count: number }[]
  designations: {
    id: number
    rank: Rank
    rankLabel: string
    title: string
    titleHi: string | null
    shortTitle: string | null
    holders: number
  }[]
  categories: {
    id: number
    code: string
    name: string
    nameHi: string | null
    icon: string
    defaultSlaHours: number
    keywords: string
    trade: Trade | null
    isActive: boolean
    sortOrder: number
    complaintCount: number
  }[]
  staff: RosterRow[]
  complaints: ComplaintTally
  projectCount: number
}

export interface CitizenRow {
  id: number
  fullName: string
  email: string
  phone: string | null
  isActive: boolean
  homeSector: { id: number; number: number; name: string } | null
  filed: number
  openFiled: number
  /** Their average rating of the work done for them, 1–5. */
  avgRating: number | null
  createdAt: string
}

export interface CitizenFile {
  citizen: Omit<CitizenRow, 'filed' | 'openFiled' | 'avgRating'>
  complaints: ConsoleComplaint[]
}

export interface ProjectDetail {
  project: ProjectRow & {
    contractor: { id: number; name: string; code: string; isBlacklisted: boolean } | null
    plannedStart: string | null
    actualStart: string | null
  }
  inspections: InspectionRow[]
}

// --- Citizen portal ----------------------------------------------------------
//
// Everything a resident sees is scoped to where they live, so most of these
// shapes carry the same `home` block describing that place.

/**
 * Where a resident lives, on the org tree.
 *
 * Named by layer rather than by tier, because how many tiers exist is a
 * setting now — a screen that says "circle" would be describing a structure the
 * authority may not have.
 */
export interface HomeContext {
  unitId: number
  unitName: string
  unitKind: string
  /** The ring outward — where a complaint goes if this layer does nothing. */
  parentId: number | null
  parentName: string | null
  parentKind: string | null
  /** Root-first: "Noida" / "Zone III" / "Sector 5". */
  trail: { id: number; name: string; kindLabel: string }[]
}

/** The rung a grievance is climbing towards, so support can be made concrete. */
export interface SupportThreshold {
  supporters: number
  priority: Priority
  remaining: number
}

/** A community grievance as it appears in the neighbourhood list. */
export interface CommunityIssue extends Complaint {
  isCommunity: true
  supporters: number
  viewerHasSupported: boolean
  viewerIsAuthor: boolean
  nextThreshold: SupportThreshold | null
  inMySector: boolean
}

export interface CommunityFeed {
  home: HomeContext | null
  needsHomeSector: boolean
  scope: 'unit' | 'area'
  items: CommunityIssue[]
}

/** An open issue nearby that resembles what someone is about to file. */
export interface SimilarIssue extends Complaint {
  isCommunity: boolean
  supporters: number
  viewerHasSupported: boolean
}

/** A public work as a resident sees it — including what it cost. */
export interface CitizenWork {
  id: number
  code: string
  name: string
  description: string | null
  department: { id: number; name: string; icon: string } | null
  sector: { id: number; number: number; name: string } | null
  contractor: { id: number; name: string; isBlacklisted: boolean } | null
  budgetAllocated: number | null
  budgetSpent: number | null
  burnPct: number | null
  completionPct: number | null
  plannedStart: string | null
  plannedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  isComplete: boolean
  isOverdue: boolean
  inspectionCount: number
  lastInspection: { conductedOn: string | null; passed: boolean | null; score: number | null } | null
}

/** Works in three rings out from home: this sector, this circle, this zone. */
export interface CitizenWorks {
  home: HomeContext | null
  needsHomeSector: boolean
  sector: CitizenWork[]
  circle: CitizenWork[]
  zone: CitizenWork[]
}

export interface OfficerContact {
  userId: number
  fullName: string
  email: string
  phone?: string | null
  rank: Rank
  rankLabel: string
  designationTitle: string
  jurisdictionLabel: string
}

/** One department's chain, from the person to approach upward. */
export interface DepartmentContacts {
  department: { id: number; name: string; nameHi: string | null; icon: string }
  /** The officer accountable for this citizen's sector — never a field worker. */
  directHead: OfficerContact
  /** Who it reaches above them if the direct head does not act, in order. */
  escalatesTo: OfficerContact[]
}

export interface CitizenContacts {
  home: HomeContext | null
  needsHomeSector: boolean
  departments: DepartmentContacts[]
}

export interface CitizenProfile {
  user: User
  home: HomeContext | null
  activity: {
    filed: number
    open: number
    resolved: number
    /** Grievances of their neighbours they have put their name to. */
    supported: number
    avgRatingGiven: number | null
  }
}

/** One resident's endorsement, shown on a grievance. */
export interface SupportEntry {
  id: number
  fullName: string
  note: string | null
  createdAt: string
}

export interface SupportOutcome {
  supporters: number
  /** Set when this support crossed a threshold and moved the priority. */
  raisedTo: Priority | null
}

// --- Street-level work -------------------------------------------------------

/** What a crew sent back from the field, as the citizen is shown it. */
export interface WorkProofView {
  note: string | null
  submittedAt: string
  files: { id: number; url: string; kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' }[]
  /** The automated confidence score, where one has been computed. */
  score: number | null
}

// --- Crew and work orders ----------------------------------------------------

export interface CrewRow {
  id: number
  fullName: string
  phone: string | null
  trade: Trade
  isActive: boolean
  sector: { id: number; number: number; name: string } | null
  department: { id: number; name: string; icon: string } | null
  contractor: { id: number; name: string; isBlacklisted: boolean } | null
  supervisor: { id: number; fullName: string } | null
  /** Live codes out with this person right now. */
  openJobs: number
}

/** What issuing a job returns: the code, and the two ways to hand it over. */
export interface IssuedWorkOrder {
  id: number
  code: string
  link: string
  qrDataUrl: string
  expiresAt: string
  crew: { id: number; fullName: string; trade: Trade } | null
}

export interface ActiveWorkOrder {
  id: number
  code: string
  status: 'ISSUED' | 'OPENED' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'CANCELLED'
  issuedAt: string
  openedAt: string | null
  expiresAt: string
  crew: { id: number; fullName: string; trade: Trade; phone: string | null } | null
}

/** One line of a verification assessment, in the words a person reads. */
export interface VerificationCheck {
  check: string
  label: string
  passed: boolean
  weight: number
  contribution: number
  detail: string
}

/** A job the pipeline could not settle, waiting on an officer. */
export interface VerificationQueueItem {
  id: number
  code: string
  submittedAt: string | null
  crew: { id: number; fullName: string; trade: Trade; phone: string | null } | null
  complaint: {
    id: number
    referenceNo: string
    title: string
    description: string
    photoUrl: string | null
    priority: Priority
    priorityScore: number | null
    category: { name: string; icon: string } | null
    sector: { id: number; number: number; name: string } | null
    citizen: { id: number; fullName: string; phone: string | null } | null
    /** false = actively disputed; null = never answered. The two differ. */
    citizenConfirmed: boolean | null
    citizenProofUrl: string | null
    feedbackComment: string | null
  }
  verification: { score: number; outcome: string; checks: VerificationCheck[] } | null
  submission: {
    note: string | null
    submittedAt: string
    /**
     * How confident the system is that the crew member named on the job is who
     * actually sent this. Recorded, never enforced — see IdentityAssurance in
     * the Prisma schema.
     */
    identityAssurance: IdentityAssurance
    files: { id: number; url: string; kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; capturedAt: string | null }[]
    /** The worker's own photograph, if they sent one. Never counts as proof. */
    selfieUrl: string | null
  } | null
}

/** Mirrors the IdentityAssurance enum in backend/prisma/schema.prisma. */
export type IdentityAssurance = 'NONE' | 'DEVICE_BOUND' | 'OTP_VERIFIED'

/** One factor behind a complaint's urgency, and what it contributed. */
export interface PriorityFactor {
  factor: string
  label: string
  raw: number
  weight: number
  contribution: number
  explanation: string
}

/** The group of near-identical reports a complaint belongs to. */
export interface ClusterRef {
  id: number
  label: string
  size: number
  isDismissed?: boolean
}

// ---------------------------------------------------------------------------
// The org tree
// ---------------------------------------------------------------------------

/** Work counted for a unit AND everything under it. Same shape at every depth. */
export interface UnitRollup {
    unitId: number
    open: number
    overdue: number
    awaitingVerification: number
    resolvedLast30d: number
    crew: number
    officers: number
}

export interface OrgUnitSummary {
    id: number
    code: string
    name: string
    kindLabel: string
    depth: number
    isLeaf: boolean
    isActive: boolean
    stats: UnitRollup
}

export interface OrgUnitDetail {
    unit: {
        id: number
        code: string
        name: string
        nameHi: string | null
        kindLabel: string
        depth: number
        isLeaf: boolean
        isActive: boolean
        population: number | null
        centroidLat: number | null
        centroidLon: number | null
    }
    parent: { id: number; name: string; kindLabel: string } | null
    /** `reachable` is false for ancestors outside the viewer's posting. */
    breadcrumb: { id: number; name: string; kindLabel: string; depth: number; reachable: boolean }[]
    stats: UnitRollup
    children: OrgUnitSummary[]
    roster: {
        postingId: number
        userId: number
        fullName: string
        email: string
        phone: string | null
        designationTitle: string | null
        employeeCode: string | null
        department: { id: number; code: string; name: string; icon: string } | null
    }[]
    removal: { canRemove: boolean; blockers: string[] }
}

/** One configured layer of a department, with how well it is actually staffed. */
export interface DepartmentLayerRow {
    id: number
    departmentId: number
    depth: number
    name: string
    namePlural: string
    canDispatch: boolean
    slaHours: number
    minPostings: number
    unitCount: number
    staffedUnitCount: number
    vacantUnitCount: number
}

export interface DepartmentLayersResponse {
    department: { id: number; code: string; name: string; icon: string }
    layers: DepartmentLayerRow[]
}

/** One judgement an engine made, and what became of it. See /admin/decisions. */
export interface DecisionRow {
    id: number
    kind: 'CATEGORY' | 'ROUTE' | 'PRIORITY' | 'NEXT_ACTION'
    complaintId: number
    chosen: string
    alternatives: { value: string; label: string; score: number }[]
    confidence: number | null
    reasons: string[]
    source: string
    outcome: 'PENDING' | 'CONFIRMED' | 'OVERRIDDEN' | 'AUTO_EXECUTED'
    overriddenTo: string | null
    overrideReason: string | null
    createdAt: string
    resolvedAt: string | null
    complaint: { id: number; referenceNo: string; title: string } | null
    actor: { id: number; fullName: string } | null
    overriddenBy: { id: number; fullName: string } | null
}

/** Agreement rate for one kind of judgement, over reviewed decisions only. */
export interface DecisionAgreement {
    kind: string
    confirmed: number
    overridden: number
    autoExecuted: number
    pending: number
    reviewed: number
    total: number
    agreementRate: number | null
}


// --- The autonomy gate -------------------------------------------------------

export interface GateThreshold {
  threshold: number
  alpha: number
  observedError: number
  coverage: number
  calibratedOn: number
  /** False where no confidence level met the tolerance. */
  automatable: boolean
  why: string
}

export interface AutonomyQueueRow {
  id: number
  complaint: {
    id: number
    referenceNo: string
    title: string
    status: ComplaintStatus
    createdAt: string
    orgUnit: { id: number; name: string; kindLabel: string } | null
  }
  /** The action the gate would take, if it were willing to take any. */
  chosen: string
  /** Renormalised over the permitted set, which is why it runs high. */
  confidence: number | null
  feasibleSet: unknown
  reasons: string[]
  createdAt: string
}

export interface AutonomyConsole {
  spec: {
    modelVersion: string
    thresholds: Record<'LOW' | 'MEDIUM' | 'HIGH', GateThreshold>
    riskOfAction: Record<string, string>
    note: string
  } | null
  total: number
  queue: AutonomyQueueRow[]
  byAction: { action: string; count: number }[]
}
