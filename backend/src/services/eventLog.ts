/**
 * The complaint lifecycle, projected as a process-mining event log.
 *
 * DRISHTI-G has been storing an event log since the first build without calling
 * it one. `ComplaintStatusHistory` records a case, an activity, an actor and a
 * timestamp — which is the definition — and `Complaint` holds the case
 * attributes you would want to slice it by. This module names that projection,
 * joins the attributes in, and exposes it as something pm4py can open.
 *
 * Why it earns its own service rather than living in a route: three separate
 * consumers need the same projection, and they must not drift apart. The admin
 * CSV export is one. The research harness — which compares this log against BPI
 * Challenge 2015 — is another. Any future model trained on "what usually happens
 * next" is the third, and a model trained on a different projection from the one
 * the papers describe would be a quiet, unfalsifiable inconsistency.
 *
 * The projection is deliberately lossless and unopinionated. One row per status
 * transition, no filtering of "uninteresting" activities, no collapsing of
 * repeats. Process mining reads deviation as signal, and a projection that
 * tidied the log would be deciding in advance what the analysis is allowed to
 * find.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { RANK_LABEL } from './hierarchy.js'

/** One row of the log: a case, an activity, when it happened, and who did it. */
export interface EventLogRow {
  /** The reference a citizen quotes — stable, human-readable, and the case id. */
  caseId: string
  /** The status the complaint moved *into*. */
  activity: string
  /** The status it moved out of, or null for the first event of a case. */
  fromActivity: string | null
  timestamp: Date
  /**
   * Who performed it, as `id · Rank Label`, or null where the system did.
   *
   * A null resource is meaningful rather than missing data: it distinguishes the
   * scheduler's automatic escalations from an officer's decisions, which is
   * exactly the split any analysis of this log will want first.
   */
  resource: string | null
  actorId: number | null

  // Case attributes, denormalised onto every row the way XES case attributes are.
  orgUnitId: number | null
  departmentId: number | null
  categoryId: number | null
  sectorId: number | null
  priority: string
  escalationLevel: number
  isCommunity: boolean
  caseStartedAt: Date
}

export interface EventLogFilter {
  /** Inclusive lower bound on event time. */
  from?: Date
  /** Exclusive upper bound on event time. */
  to?: Date
  /** Cap on rows returned, newest-bounded. Omit for the whole log. */
  limit?: number
  /**
   * Emit the case-start event that the status history does not store.
   *
   * Filing creates a complaint already in `SUBMITTED` — the schema default —
   * and writes no history row for it, because nothing *transitioned into* that
   * state. The first stored row is GCCE's `SUBMITTED -> ROUTED`. The
   * consequence only becomes visible once the log is treated as a log: every
   * case is missing its origin, so pm4py reports start activities of `ASSIGNED`
   * and `AWAITING_VERIFICATION`, and any throughput measured from the log alone
   * silently begins after routing rather than at filing.
   *
   * This synthesises that first event from `Complaint.createdAt`, which is
   * exactly the moment the case entered `SUBMITTED`. It is reconstruction, not
   * invention — but it is the one row in the projection that is not read
   * straight out of the history table, so it is switchable and named.
   *
   * Defaults to true, because a log without case starts is wrong for every
   * consumer this service has. Pass false to assert the raw count identity
   * against `ComplaintStatusHistory`.
   *
   * The deeper fix is for the filing transaction to write the row itself; see
   * docs/pending-work.md. That would only correct complaints filed afterwards,
   * so this reconstruction is needed either way for everything already stored.
   */
  includeCaseStart?: boolean
}

export interface EventLogSummary {
  events: number
  cases: number
  from: Date | null
  to: Date | null
}

function where(filter: EventLogFilter): Prisma.ComplaintStatusHistoryWhereInput {
  if (!filter.from && !filter.to) return {}
  return {
    createdAt: {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lt: filter.to } : {}),
    },
  }
}

/**
 * Project the status history into event log rows, oldest first.
 *
 * Ordered by `createdAt` then `id` because a burst of transitions inside one
 * transaction can share a timestamp to the millisecond, and a process miner
 * given them in an arbitrary order would infer transitions that never happened.
 * The insertion id breaks the tie in the order the events actually occurred.
 */
export async function buildEventLog(filter: EventLogFilter = {}): Promise<EventLogRow[]> {
  const rows = await prisma.complaintStatusHistory.findMany({
    where: where(filter),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...(filter.limit ? { take: filter.limit } : {}),
    select: {
      createdAt: true,
      fromStatus: true,
      toStatus: true,
      actorId: true,
      actor: { select: { id: true, rank: true } },
      complaint: {
        select: {
          referenceNo: true,
          orgUnitId: true,
          departmentId: true,
          categoryId: true,
          sectorId: true,
          priority: true,
          escalationLevel: true,
          isCommunity: true,
          createdAt: true,
        },
      },
    },
  })

  const projected: EventLogRow[] = rows.map((row) => ({
    caseId: row.complaint.referenceNo,
    activity: row.toStatus,
    fromActivity: row.fromStatus,
    timestamp: row.createdAt,
    resource: row.actor ? `${row.actor.id} · ${RANK_LABEL[row.actor.rank] ?? row.actor.rank}` : null,
    actorId: row.actorId,
    orgUnitId: row.complaint.orgUnitId,
    departmentId: row.complaint.departmentId,
    categoryId: row.complaint.categoryId,
    sectorId: row.complaint.sectorId,
    priority: row.complaint.priority,
    escalationLevel: row.complaint.escalationLevel,
    isCommunity: row.complaint.isCommunity,
    caseStartedAt: row.complaint.createdAt,
  }))

  if (filter.includeCaseStart === false) return projected

  return withCaseStarts(projected, filter)
}

/**
 * Prepend each case's filing event, which the history table does not hold.
 *
 * Only for cases whose first stored event is a transition *out of* SUBMITTED —
 * if a case already has a SUBMITTED row, or the log was sliced by date so its
 * earlier events are legitimately outside the window, nothing is added. That
 * second guard matters: a date-filtered log must not sprout a start event that
 * sits before the window the caller asked for.
 */
function withCaseStarts(rows: EventLogRow[], filter: EventLogFilter): EventLogRow[] {
  const firstSeen = new Map<string, EventLogRow>()
  for (const row of rows) if (!firstSeen.has(row.caseId)) firstSeen.set(row.caseId, row)

  const starts: EventLogRow[] = []
  for (const first of firstSeen.values()) {
    if (first.fromActivity !== 'SUBMITTED') continue
    if (filter.from && first.caseStartedAt < filter.from) continue
    if (filter.to && first.caseStartedAt >= filter.to) continue

    starts.push({
      ...first,
      activity: 'SUBMITTED',
      fromActivity: null,
      timestamp: first.caseStartedAt,
      // The citizen filed it, but the row is reconstructed rather than recorded,
      // so it claims no actor. Attributing it would put a resource in the log
      // that no stored row ever attested to.
      resource: null,
      actorId: null,
    })
  }

  if (starts.length === 0) return rows
  return [...starts, ...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

/**
 * Row count, distinct cases and time span — what the download control shows.
 *
 * Derived from the same projection the export writes rather than counted
 * straight off the table. Counting the table would be cheaper, but it would not
 * see the reconstructed case-start rows, and a control that advertises a
 * different number of events from the file it hands over is worse than a slow
 * one. If this table ever grows past what fits comfortably in memory, the export
 * needs cursor-based streaming first and this can follow it.
 */
export async function summariseEventLog(filter: EventLogFilter = {}): Promise<EventLogSummary> {
  const rows = await buildEventLog(filter)
  if (rows.length === 0) return { events: 0, cases: 0, from: null, to: null }

  return {
    events: rows.length,
    cases: new Set(rows.map((r) => r.caseId)).size,
    // buildEventLog returns oldest first.
    from: rows[0]!.timestamp,
    to: rows[rows.length - 1]!.timestamp,
  }
}

/**
 * CSV column order. Fixed, and `case_id`/`activity`/`timestamp` lead, because
 * pm4py's `format_dataframe` wants to be told those three by name and a stable
 * header means the research scripts never guess.
 */
export const CSV_COLUMNS = [
  'case_id',
  'activity',
  'from_activity',
  'timestamp',
  'resource',
  'actor_id',
  'org_unit_id',
  'department_id',
  'category_id',
  'sector_id',
  'priority',
  'escalation_level',
  'is_community',
  'case_started_at',
] as const

/**
 * RFC 4180 escaping.
 *
 * Rank labels contain a middle dot and officer-entered text can contain commas
 * and quotes; an unescaped field would silently shift every later column of that
 * row. Null becomes an empty field rather than the string "null", so pandas
 * reads it as NaN instead of a category called null.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? value.toISOString() : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsvRow(row: EventLogRow): string {
  return [
    row.caseId,
    row.activity,
    row.fromActivity,
    row.timestamp,
    row.resource,
    row.actorId,
    row.orgUnitId,
    row.departmentId,
    row.categoryId,
    row.sectorId,
    row.priority,
    row.escalationLevel,
    row.isCommunity,
    row.caseStartedAt,
  ]
    .map(cell)
    .join(',')
}

export function toCsv(rows: EventLogRow[]): string {
  return [CSV_COLUMNS.join(','), ...rows.map(toCsvRow)].join('\r\n') + '\r\n'
}
