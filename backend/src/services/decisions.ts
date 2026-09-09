/**
 * Every judgement the engines make, kept as data rather than as a log line.
 *
 * GCCE has always computed `reasons[]` and then flattened them into a sentence
 * on the complaint's timeline. That sentence is readable and analytically
 * useless: you cannot ask it how often the classifier is overruled, what it
 * nearly chose instead, or whether its confidence predicts agreement. Those are
 * the three questions W3's models need answered, and the autonomy gate in W4 is
 * judged entirely on the third.
 *
 * So each sub-decision becomes a row, written inside the same transaction as
 * the action it describes. That last part is the whole reliability argument: a
 * decision and the routing it produced either both land or neither does, so the
 * table can never claim the engine chose something it did not act on.
 *
 * Deliberately not the audit trail
 * --------------------------------
 * `audit.ts` records *that something happened*, is hash-chained, and must never
 * be rewritten — that is its entire value. This records *what was considered*,
 * and stays mutable, because a decision's outcome is settled later, often days
 * later, by a person disagreeing with it. Two tables because they answer two
 * questions and have opposite requirements about mutability.
 *
 * On honesty in the data
 * ----------------------
 * `alternatives` is empty wherever the engine genuinely evaluated no rivals.
 * That is a fact about the engine and it belongs in the record. Filling it with
 * plausible-looking runners-up would put fabricated labels into the training
 * set for W3.1, which is a much worse outcome than an empty array.
 */
import { DecisionKind, DecisionOutcome, type Prisma } from '@prisma/client'
import type { Db } from './audit.js'

/** One option the engine weighed, with whatever score produced the ranking. */
export interface Alternative {
  /** The option, in the same encoding as `chosen`. */
  value: string
  /** Human-readable, so the register does not need a join to be legible. */
  label: string
  /** Whatever the engine scored it on. Keyword hits today; a probability later. */
  score: number
}

export interface RecordInput {
  kind: DecisionKind
  complaintId: number
  /** The option taken. A category id, an officer id, a priority name. */
  chosen: string
  alternatives?: Alternative[]
  /**
   * 0-1, or omitted where the engine has no notion of certainty.
   *
   * Pass `basis` alongside it in `reasons` whenever this is not a calibrated
   * probability, so nobody downstream mistakes a keyword share for one.
   */
  confidence?: number | null
  feasibleSet?: unknown
  reasons: string[]
  source?: 'gcce' | 'autonomy' | 'api'
  actorId?: number | null
  /** Set directly where the decision is settled at the moment it is made. */
  outcome?: DecisionOutcome
}

/** Write one decision. Call inside the transaction that performs the action. */
export async function record(db: Db, input: RecordInput) {
  return db.decision.create({
    data: {
      kind: input.kind,
      complaintId: input.complaintId,
      chosen: input.chosen,
      alternatives: (input.alternatives ?? []) as unknown as Prisma.InputJsonValue,
      confidence: input.confidence ?? null,
      feasibleSet: (input.feasibleSet ?? null) as Prisma.InputJsonValue,
      reasons: input.reasons as unknown as Prisma.InputJsonValue,
      source: input.source ?? 'gcce',
      actorId: input.actorId ?? null,
      outcome: input.outcome ?? DecisionOutcome.PENDING,
      ...(input.outcome && input.outcome !== DecisionOutcome.PENDING
        ? { resolvedAt: new Date() }
        : {}),
    },
  })
}

export interface ResolveInput {
  complaintId: number
  kind: DecisionKind
  outcome: Extract<DecisionOutcome, 'CONFIRMED' | 'OVERRIDDEN'>
  /** What it was changed to, when someone disagreed. */
  overriddenTo?: string | null
  overriddenById?: number | null
  /** From a fixed list — free text does not aggregate into a training label. */
  overrideReason?: string | null
}

/**
 * Settle the newest pending decision of a kind for a complaint.
 *
 * Newest rather than all of them, and pending rather than any: a complaint that
 * has been recategorised twice has two CATEGORY decisions, and the citizen's
 * second correction speaks to the second one. Resolving the whole set would
 * record agreement with a judgement nobody was shown.
 *
 * Returns null when there is nothing outstanding, which is normal — the
 * feedback endpoints call this unconditionally rather than checking first, so a
 * correction on a complaint filed before this table existed is a no-op rather
 * than an error.
 */
export async function resolve(db: Db, input: ResolveInput) {
  const pending = await db.decision.findFirst({
    where: {
      complaintId: input.complaintId,
      kind: input.kind,
      outcome: DecisionOutcome.PENDING,
    },
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  if (!pending) return null

  return db.decision.update({
    where: { id: pending.id },
    data: {
      outcome: input.outcome,
      overriddenTo: input.overriddenTo ?? null,
      overriddenById: input.overriddenById ?? null,
      overrideReason: input.overrideReason ?? null,
      resolvedAt: new Date(),
    },
  })
}

/**
 * Agreement rate per kind — the number this table exists to produce.
 *
 * Pending decisions are excluded from the denominator rather than counted as
 * agreement. Most decisions are never reviewed by anyone, and treating silence
 * as approval would report a classifier as near-perfect precisely because
 * nobody was looking at it.
 */
export async function agreementByKind(db: Db) {
  const rows = await db.decision.groupBy({
    by: ['kind', 'outcome'],
    _count: { _all: true },
  })

  const byKind = new Map<
    DecisionKind,
    { confirmed: number; overridden: number; autoExecuted: number; pending: number }
  >()

  for (const row of rows) {
    const entry = byKind.get(row.kind) ?? {
      confirmed: 0,
      overridden: 0,
      autoExecuted: 0,
      pending: 0,
    }
    const n = row._count._all
    if (row.outcome === DecisionOutcome.CONFIRMED) entry.confirmed += n
    else if (row.outcome === DecisionOutcome.OVERRIDDEN) entry.overridden += n
    else if (row.outcome === DecisionOutcome.AUTO_EXECUTED) entry.autoExecuted += n
    else entry.pending += n
    byKind.set(row.kind, entry)
  }

  return [...byKind].map(([kind, counts]) => {
    const reviewed = counts.confirmed + counts.overridden
    return {
      kind,
      ...counts,
      reviewed,
      total: reviewed + counts.autoExecuted + counts.pending,
      /** Null rather than 1.0 when nobody has reviewed any of them. */
      agreementRate: reviewed > 0 ? counts.confirmed / reviewed : null,
    }
  })
}
