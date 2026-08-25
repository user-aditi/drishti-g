/**
 * GCCE — Governance Capability Coordination Engine.
 *
 * Every state-changing action goes through here. GCCE answers three questions
 * in a fixed order, and records its reasoning for each:
 *
 *   1. WHERE does this belong?  -> category, department, sector
 *   2. WHO is accountable?      -> the Section Officer for that sector, priority
 *   3. WHAT ELSE must happen?   -> notifications, GRIE rescoring, graph sync
 *
 * It routes to the **Section Officer (Junior Engineer)**, never straight to a
 * field worker. That mirrors how the authority actually works: the JE inspects,
 * decides what the job needs, and puts one of their own crew on it. Skipping
 * that step would give workers complaints they have no authority to triage.
 *
 * GCCE is deliberately deterministic. Coordination is exactly where
 * unpredictability costs most — the same complaint must always route the same
 * way, and an officer must be able to explain why it landed on their desk.
 */
import { ComplaintStatus, DepartmentStatus, Prisma, Priority, Rank } from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import * as audit from './audit.js'
import type { Db } from './audit.js'
import { findResponsibleOfficer } from './hierarchy.js'

const log = createLogger('gcce')

/** Open complaints in a sector above which new ones are escalated on arrival. */
const SECTOR_SATURATION_THRESHOLD = 25

export interface RoutingDecision {
  categoryId: number | null
  departmentId: number | null
  sectorId: number | null
  assignedOfficerId: number | null
  priority: Priority
  slaDueAt: Date | null
  /** Human-readable trace of every decision, shown to officers verbatim. */
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

/** Great-circle distance in km. Used only to pick the nearest sector centroid. */
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
 * Matching is word-boundary aware, so "light" does not match inside "delighted".
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

  // Only live departments can receive work, so a keyword that only matches a
  // coming-soon department must not silently capture the complaint.
  const categories = await db.complaintCategory.findMany({
    where: { isActive: true, department: { status: DepartmentStatus.ACTIVE } },
    select: { id: true, name: true, keywords: true },
  })
  const match = matchCategory(`${complaint.title} ${complaint.description}`, categories)

  if (!match) {
    return {
      categoryId: null,
      reason: 'No category keywords matched — held for manual categorisation.',
    }
  }
  return {
    categoryId: match.id,
    reason: `Identified as "${match.name}" from ${match.hits} keyword${match.hits === 1 ? '' : 's'} in the complaint text.`,
  }
}

async function resolveSector(
  db: Db,
  complaint: RoutableComplaint,
): Promise<{ sectorId: number | null; reason: string }> {
  if (complaint.latitude != null && complaint.longitude != null) {
    const sectors = await db.sector.findMany({
      where: { centroidLat: { not: null }, centroidLon: { not: null } },
    })
    if (sectors.length > 0) {
      let nearest = sectors[0]!
      let best = Number.POSITIVE_INFINITY
      for (const sector of sectors) {
        const d = haversineKm(
          complaint.latitude,
          complaint.longitude,
          sector.centroidLat!,
          sector.centroidLon!,
        )
        if (d < best) {
          best = d
          nearest = sector
        }
      }
      return {
        sectorId: nearest.id,
        reason: `Located in Sector ${nearest.number}${nearest.name ? ` (${nearest.name})` : ''}, ${best.toFixed(1)} km from its centre.`,
      }
    }
  }

  const citizen = await db.user.findUnique({ where: { id: complaint.citizenId } })
  if (citizen?.homeSectorId != null) {
    const sector = await db.sector.findUnique({ where: { id: citizen.homeSectorId } })
    return {
      sectorId: citizen.homeSectorId,
      reason: `No location was shared, so the citizen's registered Sector ${sector?.number ?? '?'} was used.`,
    }
  }

  return { sectorId: null, reason: 'Sector could not be determined — needs manual routing.' }
}

// --- Step 2: who is accountable? --------------------------------------------

/**
 * Escalate on arrival when a sector is already saturated.
 *
 * A pothole in a sector with 25 open complaints is a different problem from the
 * same pothole in a quiet one, and GRIE should see that reflected.
 */
export async function derivePriority(
  db: Db,
  sectorId: number | null,
): Promise<{ priority: Priority; reason: string }> {
  if (sectorId == null) {
    return { priority: Priority.MEDIUM, reason: 'Standard priority — sector unknown.' }
  }

  const openCount = await db.complaint.count({
    where: {
      sectorId,
      status: {
        notIn: [ComplaintStatus.CLOSED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE],
      },
    },
  })

  if (openCount >= SECTOR_SATURATION_THRESHOLD) {
    return {
      priority: Priority.HIGH,
      reason: `Raised to high priority — ${openCount} complaints are already open in this sector.`,
    }
  }
  return {
    priority: Priority.MEDIUM,
    reason: `Standard priority — ${openCount} complaint${openCount === 1 ? '' : 's'} open in this sector.`,
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
      slaDueAt = new Date(Date.now() + category.defaultSlaHours * 3_600_000)
      reasons.push(
        `Referred to the ${category.department.name} with a ${category.defaultSlaHours}-hour resolution target.`,
      )
    }
  }

  const { sectorId, reason: sectorReason } = await resolveSector(db, complaint)
  reasons.push(sectorReason)

  const { priority, reason: priorityReason } = await derivePriority(db, sectorId)
  reasons.push(priorityReason)

  // Route to the Section Officer, who triages and assigns a worker.
  let assignedOfficerId: number | null = null
  if (departmentId != null && sectorId != null) {
    const officer = await findResponsibleOfficer(db, {
      departmentId,
      sectorId,
      rank: Rank.SECTION_OFFICER,
    })
    if (officer) {
      assignedOfficerId = officer.userId
      const title = officer.designationTitle ?? 'Section Officer'
      reasons.push(
        `Assigned to ${officer.fullName}, ${title} for this sector (${officer.openLoad} open case${officer.openLoad === 1 ? '' : 's'}).`,
      )
    } else {
      // Fall back up the chain rather than leaving it unowned — a vacant JE post
      // must not mean a complaint nobody is accountable for.
      const circleOfficer = await findResponsibleOfficer(db, {
        departmentId,
        sectorId,
        rank: Rank.CIRCLE_OFFICER,
      })
      if (circleOfficer) {
        assignedOfficerId = circleOfficer.userId
        reasons.push(
          `No Section Officer is posted to this sector, so it went to ${circleOfficer.fullName}, ${circleOfficer.designationTitle ?? 'Circle Officer'}.`,
        )
      } else {
        reasons.push('No officer is currently posted to this sector for this department.')
      }
    }
  } else {
    reasons.push('Department or sector unresolved, so no officer could be assigned.')
  }

  const nextStatus =
    assignedOfficerId != null ? ComplaintStatus.ASSIGNED : ComplaintStatus.ROUTED

  await db.complaint.update({
    where: { id: complaint.id },
    data: {
      categoryId,
      departmentId,
      sectorId,
      assignedOfficerId,
      priority,
      slaDueAt,
      status: nextStatus,
    },
  })

  await db.complaintStatusHistory.create({
    data: {
      complaintId: complaint.id,
      fromStatus: complaint.status,
      toStatus: nextStatus,
      // Deliberately unattributed: the citizen filed the complaint, but the
      // routing decision was the engine's. Crediting it to them would misread
      // the trail as the public choosing their own department and officer.
      actorId: null,
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

  if (assignedOfficerId != null) {
    notifications.push({
      userId: assignedOfficerId,
      title: `New complaint: ${complaint.title}`,
      body: `${complaint.referenceNo} has been assigned to you for action. Priority: ${priority.toLowerCase()}.`,
      link: `/complaints/${complaint.id}`,
    })
    triggered.push('notify_officer')
  }
  await db.notification.createMany({ data: notifications })

  if (sectorId != null) triggered.push(`grie_rescore:sector:${sectorId}`)

  await audit.record(db, {
    action: 'complaint.routed',
    entityType: 'complaint',
    entityId: complaint.id,
    payload: { categoryId, departmentId, sectorId, assignedOfficerId, priority, reasons, triggered },
    actorId: actor?.id ?? null,
    actorLabel: actor?.fullName ?? 'GCCE',
    source: 'gcce',
  })

  log.info(
    `routed ${complaint.referenceNo} -> dept=${departmentId} sector=${sectorId} officer=${assignedOfficerId}`,
  )

  return {
    categoryId,
    departmentId,
    sectorId,
    assignedOfficerId,
    priority,
    slaDueAt,
    reasons,
    triggered,
  }
}

// --- The state machine -------------------------------------------------------

/**
 * Which statuses may follow which.
 *
 * Written in code rather than a workflow engine — the plan explicitly chose
 * this over adopting Camunda.
 */
export const ALLOWED_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  [ComplaintStatus.SUBMITTED]: [
    ComplaintStatus.ROUTED,
    ComplaintStatus.ASSIGNED,
    ComplaintStatus.REJECTED,
    ComplaintStatus.DUPLICATE,
  ],
  [ComplaintStatus.ROUTED]: [
    ComplaintStatus.ASSIGNED,
    ComplaintStatus.REJECTED,
    ComplaintStatus.DUPLICATE,
  ],
  [ComplaintStatus.ASSIGNED]: [
    ComplaintStatus.IN_PROGRESS,
    ComplaintStatus.REJECTED,
    ComplaintStatus.DUPLICATE,
  ],
  [ComplaintStatus.IN_PROGRESS]: [
    ComplaintStatus.AWAITING_VERIFICATION,
    ComplaintStatus.REJECTED,
  ],
  // The officer either accepts the work or sends it back to the worker.
  [ComplaintStatus.AWAITING_VERIFICATION]: [
    ComplaintStatus.RESOLVED,
    ComplaintStatus.IN_PROGRESS,
  ],
  [ComplaintStatus.RESOLVED]: [ComplaintStatus.CLOSED, ComplaintStatus.IN_PROGRESS],
  [ComplaintStatus.CLOSED]: [],
  [ComplaintStatus.REJECTED]: [],
  [ComplaintStatus.DUPLICATE]: [],
}

export function canTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Statuses that mean the complaint is still someone's problem. */
export const OPEN_STATUSES: ComplaintStatus[] = [
  ComplaintStatus.SUBMITTED,
  ComplaintStatus.ROUTED,
  ComplaintStatus.ASSIGNED,
  ComplaintStatus.IN_PROGRESS,
  ComplaintStatus.AWAITING_VERIFICATION,
]

/** Statuses that do not represent real work — excluded from every rate GRIE computes. */
export const DISCOUNTED_STATUSES: ComplaintStatus[] = [
  ComplaintStatus.REJECTED,
  ComplaintStatus.DUPLICATE,
]

/** The minimum rank allowed to make each transition. */
export const TRANSITION_MIN_RANK: Partial<Record<ComplaintStatus, Rank>> = {
  [ComplaintStatus.AWAITING_VERIFICATION]: Rank.FIELD_WORKER,
  [ComplaintStatus.IN_PROGRESS]: Rank.FIELD_WORKER,
  [ComplaintStatus.RESOLVED]: Rank.SECTION_OFFICER,
  [ComplaintStatus.REJECTED]: Rank.SECTION_OFFICER,
  [ComplaintStatus.DUPLICATE]: Rank.SECTION_OFFICER,
  // Closing is a sign-off, and a JE must not sign off their own work.
  [ComplaintStatus.CLOSED]: Rank.CIRCLE_OFFICER,
}
