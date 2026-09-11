/**
 * GRIE's five signals, computed from this system's own records. Layer 3.
 *
 * These have to be the numbers `research/drishti_research/nyc_signals.py`
 * computes, or the model this backend runs is not the model the study measured:
 * a weight tuned against one definition of "repeat" means nothing applied to
 * another. `npm run layer3:measure` checks every unit-month of the panel against
 * the study's own output. Where the SQL looks roundabout, it is usually because
 * it reproduces a pandas operation exactly rather than approximately.
 *
 * One unit is (agency, community board, calendar month of filing). Each signal:
 *
 *   slaBreachRate       share filed this month that closed after their derived
 *                       deadline, or were still unclosed with the deadline
 *                       falling inside the month. Judged at the close of the
 *                       month, so a request filed on the 30th with a five-day
 *                       deadline is not breached for being open on the 31st.
 *   repeatComplaintRate share, excluding NYC's own declared duplicates, filed at
 *                       a place where an earlier request of the same type had
 *                       already been closed (F-19: the place, not the board).
 *   escalationRate      share NYC referred to another agency or closed by
 *                       enforcement, read from its resolution text. Not Layer
 *                       2's escalation; NYC records none (F-12).
 *   openComplaintLoad   requests filed by the close of the month and not closed
 *                       by it.
 *   avgResolutionDays   mean days-to-close of requests closing this month,
 *                       leaving out the ones closed before they were filed
 *                       (F-29).
 *
 * Why closure time and not status decides "open" here, when everywhere else
 * status does (F-27): these are questions about the close of a past month, and
 * NYC's status was observed once, at the snapshot, years later. The closure
 * time is the only record of what was open then.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export interface UnitMonth {
  agencyId: number
  agencyCode: string
  orgUnitId: number
  boardCode: string
  /** First instant of the month, in record time. */
  month: Date
  requests: number
  slaBreachRate: number
  repeatComplaintRate: number
  escalationRate: number
  openComplaintLoad: number
  avgResolutionDays: number
  /** The following month's missed-deadline rate, when that month is on record with enough requests. */
  nextBreachRate: number | null
}

export interface Markers {
  referral: string[]
  enforcement: string[]
  duplicate: string[]
}

const patterns = (markers: string[]) => markers.map((m) => `%${m.toLowerCase()}%`)

/**
 * Every unit-month with at least `minRequests` filed, with its signals.
 *
 * All of them at once: the window that finds repeats has to see a place's whole
 * history, and the open-load count every earlier month, so there is no cheaper
 * way to compute one month than to compute the lot. It takes a few seconds over
 * 355,000 requests and runs on a recompute, not per page view.
 */
export async function unitMonths(markers: Markers, minRequests: number): Promise<UnitMonth[]> {
  const rows = await prisma.$queryRaw<
    (Omit<UnitMonth, 'requests' | 'openComplaintLoad'> & { requests: number; openComplaintLoad: bigint | number })[]
  >(unitMonthsQuery(markers, minRequests))
  return rows.map((r) => ({ ...r, openComplaintLoad: Number(r.openComplaintLoad) }))
}

/** The statement itself, separate so its plan can be inspected. */
export function unitMonthsQuery(markers: Markers, minRequests: number): Prisma.Sql {
  const referral = patterns(markers.referral)
  const enforcement = patterns(markers.enforcement)
  const duplicate = patterns(markers.duplicate)

  return Prisma.sql`
    WITH base AS (
      SELECT r.id, r."agencyId", r."orgUnitId", r."typeId", r."createdAt", r."closedAt", r."slaDueAt",
             date_trunc('month', r."createdAt") AS month,
             -- The place a repair either held or did not: the address, or failing
             -- that the coordinate pair to five decimals (about a metre).
             CASE
               WHEN btrim(coalesce(r.address, '')) <> '' THEN upper(btrim(r.address))
               -- Rounded as numpy rounds: scale, round half to even in double
               -- precision, scale back. numeric's round() breaks ties away from
               -- zero and put ~70 requests in a different place from the study.
               WHEN r.latitude IS NOT NULL AND r.longitude IS NOT NULL
                 THEN (round(r.latitude * 100000::float8) / 100000::float8)::text || ','
                   || (round(r.longitude * 100000::float8) / 100000::float8)::text
               ELSE ''
             END AS place,
             lower(coalesce(r."resolutionNote", '')) AS note
      FROM service_requests r
      -- A request that cannot be placed on a board cannot be attributed to a unit.
      WHERE r."orgUnitId" IS NOT NULL AND r."slaDueAt" IS NOT NULL
    ),
    flagged AS (
      SELECT b.*,
        (b.note LIKE ANY (${referral}::text[]) OR b.note LIKE ANY (${enforcement}::text[])) AS escalated,
        b.note LIKE ANY (${duplicate}::text[]) AS duplicate,
        -- Did anything of this type at this place close before this was filed?
        -- The running minimum of earlier closures answers it in one pass; ties
        -- on filing time fall back to import order, as the study's stable sort does.
        CASE WHEN b.place = '' THEN false ELSE coalesce(
          min(b."closedAt") OVER (
            PARTITION BY b.place, b."typeId" ORDER BY b."createdAt", b.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) < b."createdAt", false) END AS repeat,
        ((b."closedAt" IS NOT NULL AND b."closedAt" > b."slaDueAt")
          OR (b."closedAt" IS NULL AND b."slaDueAt" < b.month + interval '1 month')) AS breached,
        CASE WHEN b."closedAt" >= b."createdAt"
          THEN extract(epoch FROM (b."closedAt" - b."createdAt")) / 86400.0 END AS days
      FROM base b
    ),
    months AS (
      SELECT "agencyId", "orgUnitId", month,
        count(*)::int AS requests,
        avg(breached::int)::float8 AS "slaBreachRate",
        avg(escalated::int)::float8 AS "escalationRate",
        coalesce(avg(repeat::int) FILTER (WHERE NOT duplicate), 0)::float8 AS "repeatComplaintRate"
      FROM flagged GROUP BY 1, 2, 3
      HAVING count(*) >= ${minRequests}
    ),
    closing AS (
      SELECT "agencyId", "orgUnitId", date_trunc('month', "closedAt") AS month,
        avg(days)::float8 AS days
      FROM flagged WHERE "closedAt" IS NOT NULL GROUP BY 1, 2, 3
    ),
    -- Open at the close of month m = filed by then, less closed by then: one
    -- running total of arrivals and departures. A request closed before it was
    -- filed departs in its filing month, so it is never counted open. (The
    -- first version used two correlated subqueries, which the planner inlined
    -- into a rescan of all 350,000 requests per unit-month: ten minutes, F-40.)
    flow AS (
      SELECT "agencyId", "orgUnitId", month, sum(delta) AS delta FROM (
        SELECT "agencyId", "orgUnitId", month, 1 AS delta FROM base
        UNION ALL
        SELECT "agencyId", "orgUnitId", date_trunc('month', greatest("createdAt", "closedAt")), -1
        FROM base WHERE "closedAt" IS NOT NULL
      ) events GROUP BY 1, 2, 3
    ),
    open_load AS (
      SELECT "agencyId", "orgUnitId", month,
        sum(delta) OVER (PARTITION BY "agencyId", "orgUnitId" ORDER BY month) AS n
      FROM flow
    ),
    scored AS (
      SELECT m.*,
        coalesce(c.days, 0)::float8 AS "avgResolutionDays",
        l.n AS "openComplaintLoad",
        lead(m.month) OVER w AS next_month,
        lead(m."slaBreachRate") OVER w AS next_rate
      FROM months m
      -- Every scored month filed at least minRequests, so it has a flow row.
      JOIN open_load l ON l."agencyId" = m."agencyId" AND l."orgUnitId" = m."orgUnitId" AND l.month = m.month
      LEFT JOIN closing c ON c."agencyId" = m."agencyId" AND c."orgUnitId" = m."orgUnitId" AND c.month = m.month
      WINDOW w AS (PARTITION BY m."agencyId", m."orgUnitId" ORDER BY m.month)
    )
    SELECT s."agencyId", a.code AS "agencyCode", s."orgUnitId", u.code AS "boardCode", s.month,
      s.requests, s."slaBreachRate", s."repeatComplaintRate", s."escalationRate",
      s."openComplaintLoad", s."avgResolutionDays",
      -- Only the very next month counts. A gap means the unit went quiet, and
      -- what followed it is a different situation.
      CASE WHEN s.next_month = s.month + interval '1 month' THEN s.next_rate END AS "nextBreachRate"
    FROM scored s
    JOIN agencies a ON a.id = s."agencyId"
    JOIN org_units u ON u.id = s."orgUnitId"
    ORDER BY s.month, a.code, u.code
  `
}
