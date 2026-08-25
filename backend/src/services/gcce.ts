/**
 * GCCE — Governance Capability Coordination Engine.
 *
 * Every state-changing action goes through here. GCCE answers three questions
 * in a fixed order, and records its reasoning for each:
 *
 *   1. WHERE does this belong?  -> category, department, ward
 *   2. WHO is accountable?      -> assignee, priority
 *   3. WHAT ELSE must happen?   -> notifications, GRIE rescoring, graph sync
 *
 * It is deliberately deterministic. The plan rules out autonomous multi-step
 * agents, and coordination is exactly where unpredictability would cost most:
 * the same complaint must always route the same way, and a supervisor must be
 * able to explain why it did.
 */
import { ComplaintStatus, Prisma, Priority, UserRole } from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import * as audit from './audit.js'
import type { Db } from './audit.js'

const log = createLogger('gcce')

/** Open complaints in a ward above which new ones are escalated. */
const WARD_SATURATION_THRESHOLD = 30

export interface RoutingDecision {
  categoryId: number | null
  departmentId: number | null
  wardId: number | null
  assigneeId: number | null
  priority: Priority
  slaDueAt: Date | null
  /** Human-readable trace of every decision, shown to supervisors verbatim. */
  reasons: string[]
  /** Downstream effects GCCE fired, e.g. notify_citizen, grie_rescore. */
  triggered: string[]
}

export interface RoutableComplaint {
  id: number
  title: string
  description: string
  citizenId: number
  categoryId: number | null
  latitude: number | null
  longitude: number | null
  referenceNo: string
  status: ComplaintStatus
}

// --- Step 1: where does this belong? ----------------------------------------

/** Great-circle distance in km. Used only to pick the nearest ward centroid. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export interface KeywordCategory {
  id: number
  name: string
  keywords: string
}

/**
 * Keyword match over category hints.
 *
 * This is the fallback path. When the MuRIL/IndicBERT classifier lands it
 * becomes the primary, and this stays as the answer for low-confidence
 * predictions — so a complaint is never left uncategorised.
 *
 * Matching is word-boundary aware: "light" must not match inside "delighted".
 */
export function matchCategory(
  text: string,
  categories: KeywordCategory[],
): { id: number; name: string; hits: number } | null {
  const haystack = text.toLowerCase()
  let best: { id: number; name: string; hits: number } | null = null

  for (const category of categories) {
    const hints = category.keywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)

    let hits = 0
    for (const hint of hints) {
      const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'u').test(haystack)) hits += 1
    }

    if (hits > 0 && (!best || hits > best.hits)) {
      best = { id: category.id, name: category.name, hits }
    }
  }

  return best
}

async function resolveCategory(
  db: Db,
  complaint: RoutableComplaint,
): Promise<{ categoryId: number | null; reason: string }> {
  if (complaint.categoryId != null) {
    return { categoryId: complaint.categoryId, reason: 'Category was chosen by the citizen.' }
  }

  const categories = await db.complaintCategory.findMany({
    select: { id: true, name: true, keywords: true },
  })
  const match = matchCategory(`${complaint.title} ${complaint.description}`, categories)

  if (!match) {
    return {
      categoryId: null,
      reason: 'No category keywords matched — left for manual categorisation.',
    }
  }
  return {
    categoryId: match.id,
    reason: `Identified as "${match.name}" from ${match.hits} keyword${match.hits === 1 ? '' : 's'} in the complaint text.`,
  }
}

async function resolveWard(
  db: Db,
  complaint: RoutableComplaint,
): Promise<{ wardId: number | null; reason: string }> {
  if (complaint.latitude != null && complaint.longitude != null) {
    const wards = await db.ward.findMany({
      where: { centroidLat: { not: null }, centroidLon: { not: null } },
    })
    if (wards.length > 0) {
      let nearest = wards[0]!
      let best = Number.POSITIVE_INFINITY
      for (const ward of wards) {
        const d = haversineKm(complaint.latitude, complaint.longitude, ward.centroidLat!, ward.centroidLon!)
        if (d < best) {
          best = d
          nearest = ward
        }
      }
      return {
        wardId: nearest.id,
        reason: `Located in Ward ${nearest.wardNumber} (${nearest.name}), ${best.toFixed(1)} km from its centre.`,
      }
    }
  }

  const citizen = await db.user.findUnique({ where: { id: complaint.citizenId } })
  if (citizen?.wardId != null) {
    return {
      wardId: citizen.wardId,
      reason: 'No location was provided, so the citizen’s registered ward was used.',
    }
  }

  return { wardId: null, reason: 'Ward could not be determined — needs manual routing.' }
}

// --- Step 2: who is accountable? --------------------------------------------

/**
 * Least-loaded field official serving this department and ward.
 *
 * Load is counted as currently-open assignments, so work spreads rather than
 * piling onto whoever happens to sort first.
 */
export async function pickAssignee(
  db: Db,
  departmentId: number | null,
  wardId: number | null,
): Promise<{ assigneeId: number | null; reason: string }> {
  if (departmentId == null || wardId == null) {
    return {
      assigneeId: null,
      reason: 'Department or ward is unresolved, so no official could be assigned.',
    }
  }

  const officials = await db.user.findMany({
    where: { role: UserRole.FIELD_OFFICIAL, isActive: true, departmentId, wardId },
    select: {
      id: true,
      fullName: true,
      _count: {
        select: {
          assignedComplaints: {
            where: {
              status: {
                in: [ComplaintStatus.ROUTED, ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS],
              },
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  })

  if (officials.length === 0) {
    return {
      assigneeId: null,
      reason: 'No active field official covers this department and ward.',
    }
  }

  // Ties break on id, which is what makes routing reproducible.
  const chosen = officials.reduce((a, b) =>
    b._count.assignedComplaints < a._count.assignedComplaints ? b : a,
  )
  const load = chosen._count.assignedComplaints

  return {
    assigneeId: chosen.id,
    reason: `Assigned to ${chosen.fullName}, the least-loaded official for this area (${load} open task${load === 1 ? '' : 's'}).`,
  }
}

/**
 * Escalate when a ward is already saturated.
 *
 * A pothole in a ward with 30 open issues is a different problem from the same
 * pothole in a quiet ward, and GRIE should see that reflected in the priority.
 */
export async function derivePriority(
  db: Db,
  wardId: number | null,
): Promise<{ priority: Priority; reason: string }> {
  if (wardId == null) {
    return { priority: Priority.MEDIUM, reason: 'Standard priority — ward unknown.' }
  }

  const openCount = await db.complaint.count({
    where: {
      wardId,
      status: {
        notIn: [ComplaintStatus.CLOSED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE],
      },
    },
  })

  if (openCount >= WARD_SATURATION_THRESHOLD) {
    return {
      priority: Priority.HIGH,
      reason: `Raised to high priority — ${openCount} complaints are already open in this ward.`,
    }
  }
  return {
    priority: Priority.MEDIUM,
    reason: `Standard priority — ${openCount} complaint${openCount === 1 ? '' : 's'} open in this ward.`,
  }
}

// --- The coordinator itself --------------------------------------------------

/**
 * Coordinate a newly filed complaint.
 *
 * Runs inside the caller's transaction so the routing, the status history, the
 * notifications and the audit entry all land together or not at all.
 */
export async function routeComplaint(
  db: Db,
  complaint: RoutableComplaint,
  actor?: { id: number; fullName: string },
): Promise<RoutingDecision> {
  const reasons: string[] = []
  const triggered: string[] = []

  const { categoryId, reason: categoryReason } = await resolveCategory(db, complaint)
  reasons.push(categoryReason)

  let departmentId: number | null = null
  let slaDueAt: Date | null = null

  if (categoryId != null) {
    const category = await db.complaintCategory.findUnique({
      where: { id: categoryId },
      include: { department: true },
    })
    if (category) {
      departmentId = category.departmentId
      slaDueAt = new Date(Date.now() + category.defaultSlaHours * 60 * 60 * 1000)
      reasons.push(
        `Sent to the ${category.department.name} department with a ${category.defaultSlaHours}-hour resolution target.`,
      )
    }
  }

  const { wardId, reason: wardReason } = await resolveWard(db, complaint)
  reasons.push(wardReason)

  const { priority, reason: priorityReason } = await derivePriority(db, wardId)
  reasons.push(priorityReason)

  const { assigneeId, reason: assigneeReason } = await pickAssignee(db, departmentId, wardId)
  reasons.push(assigneeReason)

  const nextStatus = assigneeId != null ? ComplaintStatus.ASSIGNED : ComplaintStatus.ROUTED

  await db.complaint.update({
    where: { id: complaint.id },
    data: { categoryId, departmentId, wardId, assignedToId: assigneeId, priority, slaDueAt, status: nextStatus },
  })

  await db.complaintStatusHistory.create({
    data: {
      complaintId: complaint.id,
      fromStatus: complaint.status,
      toStatus: nextStatus,
      actorId: actor?.id ?? null,
      note: `Routed by GCCE. ${reasons.join(' ')}`,
    },
  })

  // Step 3: downstream effects.
  const notifications: Prisma.NotificationCreateManyInput[] = [
    {
      userId: complaint.citizenId,
      title: 'Complaint registered',
      body: `Your complaint ${complaint.referenceNo} has been received and routed. You will be notified as it progresses.`,
      link: `/complaints/${complaint.id}`,
    },
  ]
  triggered.push('notify_citizen')

  if (assigneeId != null) {
    notifications.push({
      userId: assigneeId,
      title: `New task: ${complaint.title}`,
      body: `Complaint ${complaint.referenceNo} has been assigned to you. Priority: ${priority.toLowerCase()}.`,
      link: `/tasks/${complaint.id}`,
    })
    triggered.push('notify_assignee')
  }
  await db.notification.createMany({ data: notifications })

  if (wardId != null) triggered.push(`grie_rescore:ward:${wardId}`)

  await audit.record(db, {
    action: 'complaint.routed',
    entityType: 'complaint',
    entityId: complaint.id,
    payload: { categoryId, departmentId, wardId, assigneeId, priority, reasons, triggered },
    actorId: actor?.id ?? null,
    actorLabel: actor?.fullName ?? 'GCCE',
    source: 'gcce',
  })

  log.info(
    `routed ${complaint.referenceNo} -> dept=${departmentId} ward=${wardId} assignee=${assigneeId}`,
  )

  return { categoryId, departmentId, wardId, assigneeId, priority, slaDueAt, reasons, triggered }
}

/**
 * Which statuses may follow which.
 *
 * Encoded here rather than in a workflow engine — the plan explicitly chose
 * writing the flow in code over adopting Camunda.
 */
export const ALLOWED_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  [ComplaintStatus.SUBMITTED]: [ComplaintStatus.ROUTED, ComplaintStatus.ASSIGNED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE],
  [ComplaintStatus.ROUTED]: [ComplaintStatus.ASSIGNED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE],
  [ComplaintStatus.ASSIGNED]: [ComplaintStatus.IN_PROGRESS, ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE],
  [ComplaintStatus.IN_PROGRESS]: [ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED],
  [ComplaintStatus.RESOLVED]: [ComplaintStatus.CLOSED, ComplaintStatus.IN_PROGRESS],
  [ComplaintStatus.CLOSED]: [],
  [ComplaintStatus.REJECTED]: [],
  [ComplaintStatus.DUPLICATE]: [],
}

export function canTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}
