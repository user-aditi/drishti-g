/**
 * How urgent a complaint is, and why.
 *
 * Priority used to be a constant: MEDIUM unless something had escalated. That
 * is fine until a desk has forty open items on it, at which point the officer
 * is choosing by gut and the system is not helping. It is also the moment a
 * governance platform either earns its keep or does not — deciding what gets
 * done first *is* the governance.
 *
 * The design constraint is the same one that governs GRIE: an officer must be
 * able to ask why this complaint outranks that one and receive an answer they
 * can check by hand, and argue with. So this is a weighted sum whose factors
 * each carry their own contribution, not a model. A learned ranker would very
 * likely score better; it would also be unarguable, and an unarguable priority
 * order is one that officers quietly ignore.
 *
 * See docs/advanced-capabilities.md §3 — measuring exactly that trade-off is
 * the point of the research this project sits inside.
 */
import { ComplaintStatus, Prisma, Priority } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { OPEN_STATUSES } from './gcce.js'

export type Db = PrismaClient | Prisma.TransactionClient

export interface PriorityFactor {
  factor: string
  label: string
  /** The underlying measurement, before weighting. */
  raw: number
  weight: number
  contribution: number
  /** One sentence an officer can read. */
  explanation: string
}

export interface PriorityResult {
  score: number
  priority: Priority
  factors: PriorityFactor[]
}

/**
 * Words that mean somebody could be hurt.
 *
 * English and romanised Hindi together, because a citizen writes "spark ho raha
 * hai" and means the same thing as "live wire". This is a blunt instrument and
 * is weighted accordingly — it can raise urgency, never dominate it, so a
 * dramatically-worded complaint about a dirty lane cannot outrank a calmly
 * worded one about an open electrical box.
 */
const DANGER_TERMS = [
  'spark', 'current', 'shock', 'live wire', 'electrocut', 'fire', 'aag',
  'gas leak', 'collapse', 'gir gaya', 'gir raha', 'accident', 'hadsa',
  'injur', 'ghayal', 'blood', 'khatra', 'dangerous', 'danger', 'unsafe',
  'child', 'bacha', 'bachche', 'school', 'hospital', 'snake', 'saanp',
  'drown', 'doob', 'manhole', 'open wire', 'nanga tar', 'latak',
]

/** 0-100, mapped to the four bands the rest of the system speaks in. */
export function bandFor(score: number): Priority {
  if (score >= 75) return Priority.CRITICAL
  if (score >= 55) return Priority.HIGH
  if (score >= 30) return Priority.MEDIUM
  return Priority.LOW
}

/**
 * Diminishing returns on headcount.
 *
 * The step from one household to five matters enormously; the step from forty
 * to forty-five does not. Linear scaling would let one large cluster in a dense
 * sector permanently outrank a live wire in a small one.
 */
const logScale = (n: number, ceiling: number): number =>
  Math.min(Math.log10(n + 1) / Math.log10(ceiling + 1), 1)

export async function computePriority(db: Db, complaintId: number): Promise<PriorityResult> {
  const complaint = await db.complaint.findUniqueOrThrow({
    where: { id: complaintId },
    include: {
      category: true,
      sector: true,
      cluster: true,
      _count: { select: { supports: true } },
    },
  })

  const factors: PriorityFactor[] = []
  const add = (
    factor: string,
    label: string,
    weight: number,
    raw: number,
    normalised: number,
    explanation: string,
  ) => {
    factors.push({
      factor,
      label,
      raw: Number(raw.toFixed(2)),
      weight,
      contribution: Number((weight * Math.min(Math.max(normalised, 0), 1)).toFixed(1)),
      explanation,
    })
  }

  // 1. What kind of problem it is. --------------------------------------------
  // The largest single input, and a property of the category rather than of
  // how the complaint was worded, so it cannot be talked up.
  const severity = complaint.category?.severity ?? 2
  add(
    'category_severity',
    'Type of problem',
    28,
    severity,
    (severity - 1) / 4,
    complaint.category
      ? `${complaint.category.name} carries a severity of ${severity} out of 5.`
      : 'Not yet classified, so treated as ordinary severity.',
  )

  // 2. Whether the words describe danger. -------------------------------------
  const text = `${complaint.title} ${complaint.description}`.toLowerCase()
  const hits = DANGER_TERMS.filter((term) => text.includes(term))
  add(
    'danger_signals',
    'Signs somebody could be hurt',
    14,
    hits.length,
    logScale(hits.length, 4),
    hits.length > 0
      ? `The report mentions ${hits.slice(0, 3).map((h) => `"${h}"`).join(', ')}.`
      : 'Nothing in the wording suggests immediate danger.',
  )

  // 3. How many people it affects. --------------------------------------------
  // Two independent signals of the same thing: neighbours who endorsed this
  // grievance, and neighbours who reported it separately without knowing.
  const supporters = complaint._count.supports
  const clusterSize = complaint.cluster && !complaint.cluster.isDismissed ? complaint.cluster.size : 1
  const affected = supporters + Math.max(clusterSize - 1, 0)
  add(
    'people_affected',
    'How many households it affects',
    18,
    affected,
    logScale(affected, 20),
    affected === 0
      ? 'Reported by one household, with nobody else backing it.'
      : `${supporters} ${supporters === 1 ? 'neighbour has' : 'neighbours have'} backed it` +
        (clusterSize > 1 ? `, and ${clusterSize - 1} more reported it separately.` : '.'),
  )

  // 4. How many people walk past it. ------------------------------------------
  const population = complaint.sector?.population ?? 0
  add(
    'exposure',
    'How busy the area is',
    8,
    population,
    population > 0 ? Math.min(population / 35_000, 1) : 0.3,
    population > 0
      ? `Sector ${complaint.sector?.number} has about ${population.toLocaleString('en-IN')} residents.`
      : 'No population recorded for this sector.',
  )

  // 5. Whether this sector is already failing. --------------------------------
  // Raises priority rather than lowering it, deliberately. A neglected sector's
  // complaints should be harder to ignore, not easier — the opposite rule
  // would let the worst-served areas slide furthest.
  const risk = await db.riskScore.findFirst({
    where: { entityType: 'SECTOR', entityId: complaint.sectorId ?? -1 },
    orderBy: { computedAt: 'desc' },
    select: { score: true },
  })
  add(
    'sector_pressure',
    'How well this sector is being served',
    8,
    risk?.score ?? 0,
    risk ? risk.score / 100 : 0,
    risk
      ? `This sector's risk score is ${Math.round(risk.score)} out of 100, so complaints here are already going unaddressed.`
      : 'This sector has not been scored yet.',
  )

  // 6. Whether it has been fixed before and come back. ------------------------
  let recurrence = 0
  if (complaint.sectorId != null && complaint.categoryId != null) {
    recurrence = await db.complaint.count({
      where: {
        id: { not: complaintId },
        sectorId: complaint.sectorId,
        categoryId: complaint.categoryId,
        status: { in: [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED] },
        resolvedAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
      },
    })
  }
  add(
    'recurrence',
    'Fixed before and reported again',
    9,
    recurrence,
    logScale(recurrence, 5),
    recurrence > 0
      ? `${recurrence} complaint${recurrence === 1 ? '' : 's'} of this kind ${recurrence === 1 ? 'was' : 'were'} closed here in the last three months — the earlier repair may not have held.`
      : 'Nothing of this kind has been fixed here recently.',
  )

  // 7. How long it has already waited. ----------------------------------------
  const ageDays = (Date.now() - complaint.createdAt.getTime()) / 86_400_000
  const overdue =
    complaint.slaDueAt != null &&
    complaint.slaDueAt.getTime() < Date.now() &&
    (OPEN_STATUSES as ComplaintStatus[]).includes(complaint.status)
  add(
    'waiting',
    'How long it has waited',
    5,
    ageDays,
    overdue ? 1 : logScale(ageDays, 14),
    overdue
      ? 'Already past its deadline.'
      : `Filed ${ageDays < 1 ? 'today' : `${Math.round(ageDays)} days ago`}.`,
  )

  // 8. Whether the chain of command has already had to intervene. -----------
  // This used to be applied as a floor *after* scoring, which produced
  // complaints marked High on a score of 13 — a band and a number that
  // contradicted each other, in a system whose whole claim is that the number
  // explains the band. It is a factor like everything else now.
  const escalation = complaint.escalationLevel
  add(
    'escalation',
    'Already pushed up the chain',
    10,
    escalation,
    escalation === 0 ? 0 : escalation === 1 ? 0.6 : escalation === 2 ? 0.85 : 1,
    escalation === 0
      ? 'Still with the officer it was routed to.'
      : `Missed its deadline and was escalated ${escalation} time${escalation === 1 ? '' : 's'}.`,
  )

  const score = Number(factors.reduce((sum, f) => sum + f.contribution, 0).toFixed(1))
  return { score, priority: bandFor(score), factors }
}

/**
 * Recompute and store a complaint's priority.
 *
 * A caller may pass a floor, which is how a deliberate human override survives
 * an automated recompute — `console.ts` lets a Super Admin set priority by hand,
 * and having a sweep quietly undo that would make the override worthless.
 */
export async function applyPriority(
  db: Db,
  complaintId: number,
  options: { floor?: Priority } = {},
): Promise<PriorityResult> {
  const result = await computePriority(db, complaintId)

  const rank: Record<Priority, number> = {
    [Priority.LOW]: 0,
    [Priority.MEDIUM]: 1,
    [Priority.HIGH]: 2,
    [Priority.CRITICAL]: 3,
  }

  // Escalation is inside the score now, so the only floor left is one a caller
  // asks for explicitly — which is how a human override survives a recompute.
  const floor = options.floor
  const chosen = floor
    ? [result.priority, floor].reduce((a, b) => (rank[a] >= rank[b] ? a : b))
    : result.priority

  await db.complaint.update({
    where: { id: complaintId },
    data: {
      priority: chosen,
      priorityScore: result.score,
      priorityFactors: result.factors as unknown as Prisma.InputJsonValue,
    },
  })

  return { ...result, priority: chosen }
}

/**
 * How many more neighbours it would take to move this up a band.
 *
 * Simulates the score with additional supporters rather than consulting a table
 * of thresholds, so the promise shown to a citizen — "three more neighbours
 * makes this high priority" — stays true even though priority depends on six
 * other things besides support.
 */
export async function supportsNeededForNextBand(
  db: Db,
  complaintId: number,
): Promise<{ remaining: number; priority: Priority } | null> {
  const base = await computePriority(db, complaintId)
  const rank: Record<Priority, number> = {
    [Priority.LOW]: 0,
    [Priority.MEDIUM]: 1,
    [Priority.HIGH]: 2,
    [Priority.CRITICAL]: 3,
  }

  const affected = base.factors.find((f) => f.factor === 'people_affected')
  if (!affected) return null

  const others = base.score - affected.contribution

  // Support is log-scaled, so past a certain point no realistic number of
  // neighbours moves the band. Twenty-five is where the curve has flattened.
  for (let extra = 1; extra <= 25; extra++) {
    const raw = affected.raw + extra
    const contribution = affected.weight * Math.min(Math.log10(raw + 1) / Math.log10(21), 1)
    const band = bandFor(others + contribution)
    if (rank[band] > rank[base.priority]) return { remaining: extra, priority: band }
  }

  return null
}
