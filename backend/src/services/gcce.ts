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
 * It routes to the officer at the **leaf unit** — the layer nearest the
 * citizen — never straight to a crew member. That mirrors how the authority
 * actually works: the officer on the ground inspects, decides what the job
 * needs, and puts one of their own crew on it. Skipping that step would hand
 * work to people with no authority to triage it.
 *
 * When the leaf post is vacant, routing falls UP the tree rather than leaving
 * the complaint unowned.
 *
 * GCCE is deliberately deterministic. Coordination is exactly where
 * unpredictability costs most — the same complaint must always route the same
 * way, and an officer must be able to explain why it landed on their desk.
 */
import {
  ComplaintStatus,
  DecisionKind,
  DepartmentStatus,
  Prisma,
  Priority,
  Rank,
} from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import * as audit from './audit.js'
import * as decisions from './decisions.js'
import type { Db } from './audit.js'
import * as org from './orgTree.js'
import { estimateSla } from './sla.js'

const log = createLogger('gcce')

/** Open complaints in a sector above which new ones are escalated on arrival. */
const SECTOR_SATURATION_THRESHOLD = 25

export interface RoutingDecision {
  categoryId: number | null
  departmentId: number | null
  /// The org unit the complaint now sits at — the leaf nearest the citizen.
  orgUnitId: number | null
  /// DEPRECATED — legacy sector row, kept in step during the migration.
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
export interface CategoryMatch {
  id: number
  name: string
  hits: number
}

/**
 * Score every category, best first.
 *
 * `matchCategory` used to compute exactly this and throw away everything but
 * the winner. The runners-up are the interesting part: they are what the
 * decision record stores as `alternatives`, and they are what distinguishes a
 * misroute that was a near-miss between two plausible categories from the
 * matcher having no idea. W3.1 replaces the scoring with a trained classifier
 * and keeps this shape, so the decision table stays comparable across the
 * change.
 */
export function rankCategories(text: string, categories: KeywordCategory[]): CategoryMatch[] {
  const haystack = text.toLowerCase()
  const scored: CategoryMatch[] = []

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

    if (hits > 0) scored.push({ id: category.id, name: category.name, hits })
  }

  // Ties broken by id so the ranking is stable between runs. An unstable order
  // would make the stored alternatives irreproducible for the same text.
  return scored.sort((a, b) => b.hits - a.hits || a.id - b.id)
}

/**
 * How separated the winner is from the field, on 0-1.
 *
 * **This is not a probability.** It is the winner's share of all keyword hits
 * across every category that matched: 1.0 means nothing else matched at all,
 * 0.5 means an even split with one rival. It is recorded so the decision table
 * has a comparable column before and after W3.1 swaps in a trained classifier,
 * and every row carrying it also carries a `basis` line in `reasons` saying
 * exactly this. Nothing should threshold on it as though it were calibrated.
 */
export function keywordConfidence(ranked: CategoryMatch[]): number | null {
  if (ranked.length === 0) return null
  const total = ranked.reduce((sum, c) => sum + c.hits, 0)
  return total > 0 ? ranked[0]!.hits / total : null
}

export function matchCategory(text: string, categories: KeywordCategory[]): CategoryMatch | null {
  return rankCategories(text, categories)[0] ?? null
}

/** What the classifier considered, not just what it picked. */
interface CategoryDecision {
  categoryId: number | null
  reason: string
  ranked: CategoryMatch[]
  confidence: number | null
  /** How the confidence figure was produced, recorded alongside every row. */
  basis: string
}

async function resolveCategory(
  db: Db,
  complaint: RoutableComplaint,
): Promise<CategoryDecision> {
  // Set only by a correction — either the citizen answering the confirmation
  // shown after filing, or an officer moving the complaint by hand. A freshly
  // filed complaint always arrives here uncategorised, which is what keeps the
  // routing history a record of what the classifier decided rather than of what
  // somebody guessed.
  if (complaint.categoryId != null) {
    return {
      categoryId: complaint.categoryId,
      reason: 'Category was set by hand, so classification was not run again.',
      // No rivals, because nothing was scored — a person had already decided.
      ranked: [],
      confidence: null,
      basis: 'set by hand; the classifier did not run',
    }
  }

  // Only live departments can receive work, so a keyword that only matches a
  // coming-soon department must not silently capture the complaint.
  const categories = await db.complaintCategory.findMany({
    where: { isActive: true, department: { status: DepartmentStatus.ACTIVE } },
    select: { id: true, name: true, keywords: true },
  })
  const ranked = rankCategories(`${complaint.title} ${complaint.description}`, categories)
  const match = ranked[0]
  const basis =
    "share of matched keywords won by the leading category, not a calibrated probability"

  if (!match) {
    return {
      categoryId: null,
      reason: 'No category keywords matched — held for manual categorisation.',
      ranked: [],
      confidence: null,
      basis: 'nothing matched, so there is nothing to be confident about',
    }
  }

  return {
    categoryId: match.id,
    reason: `Identified as "${match.name}" from ${match.hits} keyword${match.hits === 1 ? '' : 's'} in the complaint text.`,
    ranked,
    confidence: keywordConfidence(ranked),
    basis,
  }
}

/**
 * Which unit does this belong to?
 *
 * Resolves against LEAF units — the layer nearest the citizen — because that is
 * where work is dispatched from. Prefers the complaint's own coordinates, falls
 * back to the citizen's registered home unit, and gives up honestly rather than
 * guessing.
 */
async function resolveUnit(
  db: Db,
  complaint: RoutableComplaint,
): Promise<{ unitId: number | null; reason: string }> {
  if (complaint.latitude != null && complaint.longitude != null) {
    const leaves = await db.orgUnit.findMany({
      where: {
        isLeaf: true,
        isActive: true,
        centroidLat: { not: null },
        centroidLon: { not: null },
      },
    })
    if (leaves.length > 0) {
      let nearest = leaves[0]!
      let best = Number.POSITIVE_INFINITY
      for (const unit of leaves) {
        const d = haversineKm(
          complaint.latitude,
          complaint.longitude,
          unit.centroidLat!,
          unit.centroidLon!,
        )
        if (d < best) {
          best = d
          nearest = unit
        }
      }
      return {
        unitId: nearest.id,
        reason: `Located in ${nearest.name}, ${best.toFixed(1)} km from its centre.`,
      }
    }
  }

  const citizen = await db.user.findUnique({ where: { id: complaint.citizenId } })
  if (citizen?.homeUnitId != null) {
    const unit = await db.orgUnit.findUnique({ where: { id: citizen.homeUnitId } })
    return {
      unitId: citizen.homeUnitId,
      reason: `No location was shared, so the citizen's registered ${unit?.kindLabel ?? 'area'} ${unit?.name ?? ''} was used.`.trim(),
    }
  }

  return { unitId: null, reason: 'Area could not be determined — needs manual routing.' }
}

/**
 * Lift a unit to the layer the department actually operates at.
 *
 * Geography is resolved against the tree's ground floor, but a department that
 * runs fewer layers stops higher up. Without this a two-layer department would
 * be handed a sector it has nobody posted to.
 */
async function liftToDepartmentLayer(
  db: Db,
  unitId: number,
  departmentId: number | null,
): Promise<{ unitId: number; note: string | null }> {
  if (departmentId == null) return { unitId, note: null }

  const targetDepth = await org.departmentLeafDepth(db, departmentId)
  const unit = await org.getUnit(db, unitId)
  if (targetDepth == null || !unit || unit.depth <= targetDepth) return { unitId, note: null }

  const ancestors = await org.getAncestors(db, unit)
  const lifted = ancestors.find((a) => a.depth === targetDepth)
  if (!lifted) return { unitId, note: null }

  return {
    unitId: lifted.id,
    note: `This department works at ${lifted.kindLabel} level, so it was raised to ${lifted.name}.`,
  }
}

/**
 * The legacy `sectors` row matching a leaf unit, kept in step during the
 * migration. Units created after the cutover have no sector, which is fine —
 * nothing new should read the column. See docs/pending-work.md.
 */
async function legacySectorIdFor(db: Db, unitId: number | null): Promise<number | null> {
  if (unitId == null) return null
  const unit = await db.orgUnit.findUnique({ where: { id: unitId } })
  const match = unit?.code.match(/^SEC-(\d+)$/)
  if (!match) return null
  const sector = await db.sector.findUnique({ where: { number: Number(match[1]) } })
  return sector?.id ?? null
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

  const category = await resolveCategory(db, complaint)
  const categoryId = category.categoryId
  reasons.push(category.reason)

  let departmentId: number | null = null
  let slaDueAt: Date | null = null
  let fallbackSlaHours = 72
  let departmentName: string | null = null

  if (categoryId != null) {
    const category = await db.complaintCategory.findUnique({
      where: { id: categoryId },
      include: { department: true },
    })
    if (category) {
      departmentId = category.departmentId
      departmentName = category.department.name
      fallbackSlaHours = category.defaultSlaHours
      reasons.push(`Referred to the ${category.department.name}.`)
    }
  }

  const resolved = await resolveUnit(db, complaint)
  reasons.push(resolved.reason)

  let unitId = resolved.unitId
  if (unitId != null) {
    const lifted = await liftToDepartmentLayer(db, unitId, departmentId)
    unitId = lifted.unitId
    if (lifted.note) reasons.push(lifted.note)
  }

  const sectorId = await legacySectorIdFor(db, resolved.unitId)

  const { priority, reason: priorityReason } = await derivePriority(db, sectorId)
  reasons.push(priorityReason)

  /*
   * The deadline, from what this kind of work has actually taken here.
   *
   * Set at this point rather than with the department, because it depends on
   * the unit and the priority and neither is known earlier. It used to be one
   * seeded number per category, identical in a sector with four open jobs and
   * one with six hundred — a promise the system had no evidence it could keep.
   *
   * `p90` is the commitment: a deadline this unit has historically met nine
   * times in ten. It is *supposed* to breach about a tenth of the time, which
   * is what makes it a promise rather than an aspiration. `p50` is what the
   * citizen is told, because "usually 2 days" is the sentence they wanted.
   */
  const sla = estimateSla(
    { categoryId: categoryId ?? 0, orgUnitId: unitId, priority },
    fallbackSlaHours,
  )
  slaDueAt = new Date(Date.now() + sla.p90 * 3_600_000)

  reasons.push(
    sla.basis === 'default'
      ? `Target ${Math.round(sla.p90)} hours${departmentName ? ` — the ${departmentName}'s standard for this category` : ''}, as nothing comparable has been resolved here yet.`
      : `Target ${Math.round(sla.p90)} hours, from ${sla.support} comparable ${sla.support === 1 ? 'complaint' : 'complaints'} resolved ${sla.basis === 'category' ? 'across the authority' : 'in this area'}.`,
  )

  // Route to the officer at the leaf unit, who triages and dispatches a crew.
  // findOwnerFor walks UP the tree on a vacancy, so a complaint is never left
  // unowned just because the nearest post happens to be empty.
  let assignedOfficerId: number | null = null
  if (departmentId != null && unitId != null) {
    const officer = await org.findOwnerFor(db, { unitId, departmentId })
    if (officer) {
      assignedOfficerId = officer.userId
      const title = officer.designationTitle ?? 'officer'
      const load = `${officer.openLoad} open case${officer.openLoad === 1 ? '' : 's'}`

      if (officer.unitId === unitId) {
        reasons.push(`Assigned to ${officer.fullName}, ${title} for this area (${load}).`)
      } else {
        const landed = await org.getUnit(db, officer.unitId)
        reasons.push(
          `Nobody is posted to this area for this department, so it went up to ${officer.fullName}, ${title} at ${landed?.kindLabel ?? 'the level'} ${landed?.name ?? 'above'} (${load}).`,
        )
      }
    } else {
      reasons.push('No officer is posted at or above this area for this department.')
    }
  } else {
    reasons.push('Department or area unresolved, so no officer could be assigned.')
  }

  /*
   * Persist what was decided, not just what was done.
   *
   * Three rows, written inside the same transaction as the routing itself, so a
   * decision and the action it produced either both land or neither does. The
   * table can therefore never claim the engine chose something it did not act
   * on — which is the property that makes it usable as a training set.
   *
   * `alternatives` is empty for ROUTE and PRIORITY because those two genuinely
   * evaluate no rivals: `findOwnerFor` walks up the tree and returns the first
   * officer it finds, and `derivePriority` applies a threshold. Recording an
   * empty list is a fact about the engine. Filling it with plausible-looking
   * runners-up would put fabricated labels into W3's training data, which is a
   * far worse outcome than an honest gap.
   */
  await decisions.record(db, {
    kind: DecisionKind.CATEGORY,
    complaintId: complaint.id,
    chosen: categoryId != null ? String(categoryId) : 'unclassified',
    alternatives: category.ranked.map((c) => ({
      value: String(c.id),
      label: c.name,
      score: c.hits,
    })),
    confidence: category.confidence,
    reasons: [category.reason, `Confidence basis: ${category.basis}.`],
    actorId: actor?.id ?? null,
  })

  await decisions.record(db, {
    kind: DecisionKind.ROUTE,
    complaintId: complaint.id,
    chosen: assignedOfficerId != null ? String(assignedOfficerId) : 'unassigned',
    alternatives: [],
    reasons: [
      resolved.reason,
      ...(unitId != null ? [] : ['No unit could be resolved.']),
      reasons[reasons.length - 1] ?? 'No officer reason recorded.',
    ],
    actorId: actor?.id ?? null,
  })

  await decisions.record(db, {
    kind: DecisionKind.PRIORITY,
    complaintId: complaint.id,
    chosen: priority,
    alternatives: [],
    reasons: [priorityReason],
    actorId: actor?.id ?? null,
  })

  const nextStatus =
    assignedOfficerId != null ? ComplaintStatus.ASSIGNED : ComplaintStatus.ROUTED

  await db.complaint.update({
    where: { id: complaint.id },
    data: {
      categoryId,
      departmentId,
      orgUnitId: unitId,
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

  if (unitId != null) triggered.push(`grie_rescore:unit:${unitId}`)

  await audit.record(db, {
    action: 'complaint.routed',
    entityType: 'complaint',
    entityId: complaint.id,
    payload: {
      categoryId,
      departmentId,
      orgUnitId: unitId,
      sectorId,
      assignedOfficerId,
      priority,
      reasons,
      triggered,
    },
    actorId: actor?.id ?? null,
    actorLabel: actor?.fullName ?? 'GCCE',
    source: 'gcce',
  })

  log.info(
    `routed ${complaint.referenceNo} -> dept=${departmentId} unit=${unitId} officer=${assignedOfficerId}`,
  )

  return {
    categoryId,
    departmentId,
    orgUnitId: unitId,
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
