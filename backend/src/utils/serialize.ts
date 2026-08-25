import type { Complaint, ComplaintCategory, Posting, Sector, User } from '@prisma/client'

// Only the fields these helpers actually read are required, so a caller may
// pass a narrowed `select` without fighting the type checker.
type DepartmentRef = { id: number; code: string; name: string; icon: string }
type AreaRef = { id: number; code: string; name: string }
type SectorRef = { id: number; number: number; name: string }

type PostingWithRefs = Posting & {
  department?: DepartmentRef | null
  zone?: AreaRef | null
  circle?: AreaRef | null
  sector?: SectorRef | null
}

export function publicPosting(p: PostingWithRefs) {
  return {
    id: p.id,
    rank: p.rank,
    level: p.level,
    designationTitle: p.designationTitle,
    trade: p.trade,
    employeeCode: p.employeeCode,
    isPrimary: p.isPrimary,
    department: p.department
      ? { id: p.department.id, code: p.department.code, name: p.department.name, icon: p.department.icon }
      : null,
    zone: p.zone ? { id: p.zone.id, code: p.zone.code, name: p.zone.name } : null,
    circle: p.circle ? { id: p.circle.id, code: p.circle.code, name: p.circle.name } : null,
    sector: p.sector ? { id: p.sector.id, number: p.sector.number, name: p.sector.name } : null,
  }
}

type UserWithRefs = User & {
  homeSector?: Sector | null
  postings?: PostingWithRefs[]
}

/** Strip the password hash. Never send a User straight to the client. */
export function publicUser(user: UserWithRefs) {
  const { hashedPassword: _omit, ...rest } = user
  const postings = user.postings?.map(publicPosting) ?? []
  return {
    ...rest,
    homeSector: user.homeSector
      ? { id: user.homeSector.id, number: user.homeSector.number, name: user.homeSector.name }
      : null,
    postings,
    /** The posting the UI should lead with. */
    primaryPosting: postings.find((p) => p.isPrimary) ?? postings[0] ?? null,
  }
}

type ComplaintWithRefs = Complaint & {
  category?: ComplaintCategory | null
  department?: DepartmentRef | null
  sector?:
    | (SectorRef & { circle?: ({ id: number; name: string } & { zone?: { id: number; name: string } | null }) | null })
    | null
  citizen?: User | null
  assignedOfficer?: User | null
  assignedWorker?: User | null
}

/** Shape a complaint for the client, flattening the relations the UI shows. */
export function publicComplaint(c: ComplaintWithRefs) {
  return {
    id: c.id,
    referenceNo: c.referenceNo,
    title: c.title,
    description: c.description,
    photoUrl: c.photoUrl,
    latitude: c.latitude,
    longitude: c.longitude,
    address: c.address,
    landmark: c.landmark,
    status: c.status,
    priority: c.priority,
    slaDueAt: c.slaDueAt,
    resolvedAt: c.resolvedAt,
    closedAt: c.closedAt,
    escalationLevel: c.escalationLevel,
    feedbackRating: c.feedbackRating,
    feedbackComment: c.feedbackComment,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    category: c.category
      ? { id: c.category.id, name: c.category.name, icon: c.category.icon, trade: c.category.trade }
      : null,
    department: c.department
      ? { id: c.department.id, name: c.department.name, code: c.department.code, icon: c.department.icon }
      : null,
    sector: c.sector
      ? {
          id: c.sector.id,
          number: c.sector.number,
          name: c.sector.name,
          circle: c.sector.circle
            ? {
                id: c.sector.circle.id,
                name: c.sector.circle.name,
                zone: c.sector.circle.zone
                  ? { id: c.sector.circle.zone.id, name: c.sector.circle.zone.name }
                  : null,
              }
            : null,
        }
      : null,
    citizen: c.citizen
      ? { id: c.citizen.id, fullName: c.citizen.fullName, phone: c.citizen.phone }
      : null,
    assignedOfficer: c.assignedOfficer
      ? { id: c.assignedOfficer.id, fullName: c.assignedOfficer.fullName, rank: c.assignedOfficer.rank }
      : null,
    assignedWorker: c.assignedWorker
      ? { id: c.assignedWorker.id, fullName: c.assignedWorker.fullName }
      : null,
  }
}

/**
 * Sequential per-year reference, e.g. DG-2026-000042.
 *
 * Derived from the row id rather than a counter, so it cannot collide and needs
 * no extra table.
 */
export function referenceNoFor(id: number, at: Date = new Date()): string {
  return `DG-${at.getFullYear()}-${String(id).padStart(6, '0')}`
}

/** Prisma include for a complaint with everything the client renders. */
export const COMPLAINT_INCLUDE = {
  category: true,
  department: true,
  sector: { include: { circle: { include: { zone: true } } } },
  citizen: true,
  assignedOfficer: true,
  assignedWorker: true,
} as const
