import type { Complaint, ComplaintCategory, Department, User, Ward } from '@prisma/client'

/** Strip the password hash. Never send a User straight to the client. */
export function publicUser(
  user: User & { ward?: Ward | null; department?: Department | null },
) {
  const { hashedPassword: _omit, ...rest } = user
  return {
    ...rest,
    ward: user.ward ? { id: user.ward.id, wardNumber: user.ward.wardNumber, name: user.ward.name } : null,
    department: user.department
      ? { id: user.department.id, code: user.department.code, name: user.department.name }
      : null,
  }
}

type ComplaintWithRelations = Complaint & {
  category?: ComplaintCategory | null
  department?: Department | null
  ward?: Ward | null
  citizen?: User | null
  assignedTo?: User | null
}

/** Shape a complaint for the client, flattening the relations the UI actually shows. */
export function publicComplaint(c: ComplaintWithRelations) {
  return {
    id: c.id,
    referenceNo: c.referenceNo,
    title: c.title,
    description: c.description,
    photoUrl: c.photoUrl,
    latitude: c.latitude,
    longitude: c.longitude,
    address: c.address,
    status: c.status,
    priority: c.priority,
    slaDueAt: c.slaDueAt,
    resolvedAt: c.resolvedAt,
    closedAt: c.closedAt,
    feedbackRating: c.feedbackRating,
    feedbackComment: c.feedbackComment,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    category: c.category ? { id: c.category.id, name: c.category.name, icon: c.category.icon } : null,
    department: c.department ? { id: c.department.id, name: c.department.name, code: c.department.code } : null,
    ward: c.ward ? { id: c.ward.id, wardNumber: c.ward.wardNumber, name: c.ward.name } : null,
    citizen: c.citizen ? { id: c.citizen.id, fullName: c.citizen.fullName, phone: c.citizen.phone } : null,
    assignedTo: c.assignedTo ? { id: c.assignedTo.id, fullName: c.assignedTo.fullName } : null,
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
