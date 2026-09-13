import { Router } from 'express'
import { referenceDate } from '../config/systemClock.js'
import { prisma } from '../lib/prisma.js'
import { z } from 'zod'
import { sendCsv, toCsv } from '../utils/csv.js'
import { asyncHandler, badRequest } from '../utils/http.js'

export const boardsRouter: Router = Router()

interface BoardRow {
  id: number
  code: string
  name: string
  centroidLat: number | null
  centroidLon: number | null
  total: bigint
  open: bigint
  closed: bigint
  overdue: bigint
  medianResolutionHours: number | null
}

export interface BoardFigures {
  id: number
  code: string
  name: string
  centroidLat: number | null
  centroidLon: number | null
  total: number
  open: number
  closed: number
  overdue: number
  medianResolutionHours: number | null
}

/**
 * Memory for the percentile's sort.
 *
 * `PERCENTILE_CONT` is an ordered-set aggregate, so it has to sort every closed
 * request in a board before it can pick the middle one — about 350,000 rows and
 * 28MB of working set across the borough. At Postgres's default 4MB `work_mem`
 * that sort spills to disk. Set with `SET LOCAL` so it applies to this one query
 * and is released with it, rather than being raised for every connection.
 */
const SORT_MEMORY = '64MB'

/**
 * Volume, resolution time and backlog for each of Brooklyn's 18 community boards.
 *
 * **A median, not a mean.** Resolution times are violently skewed — Street Light
 * Condition has a p50 of 139 hours against a p90 of 1,881 — so a mean reports a
 * number no request actually experienced. `PERCENTILE_CONT` is also the one
 * aggregate Prisma cannot express, which is why this is raw SQL.
 *
 * **Open means NYC's published status**, as everywhere in the system, so overdue
 * is always a subset of open (F-27). **Durations use closed_date only where it
 * is not before the filing** — 2,382 imported rows close before they were filed,
 * and the research harness and fidelity check both drop them.
 *
 * **Overdue is counted against the system reference date**, never `Date.now()`.
 */
async function compute(now: Date, agencyId: number | null): Promise<BoardFigures[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL work_mem = '${SORT_MEMORY}'`),
    prisma.$queryRaw<BoardRow[]>`
      WITH per_board AS (
        SELECT r."orgUnitId" AS id,
               COUNT(*)                                        AS total,
               COUNT(*) FILTER (WHERE r.status <> 'CLOSED')     AS open,
               COUNT(*) FILTER (WHERE r.status = 'CLOSED')      AS closed,
               COUNT(*) FILTER (
                 WHERE r.status <> 'CLOSED' AND r."slaDueAt" <
                   CASE WHEN r."isImported" THEN ${now} ELSE now() END
               )                                                AS overdue,
               PERCENTILE_CONT(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (r."closedAt" - r."createdAt")) / 3600.0
               ) FILTER (
                 WHERE r."closedAt" IS NOT NULL AND r."closedAt" >= r."createdAt"
               )                                                AS median_hours
        FROM service_requests r
        WHERE r."orgUnitId" IS NOT NULL
          AND (${agencyId}::int IS NULL OR r."agencyId" = ${agencyId}::int)
        GROUP BY r."orgUnitId"
      )
      SELECT u.id,
             u.code,
             u.name,
             u."centroidLat",
             u."centroidLon",
             COALESCE(b.total, 0)   AS total,
             COALESCE(b.open, 0)    AS open,
             COALESCE(b.closed, 0)  AS closed,
             COALESCE(b.overdue, 0) AS overdue,
             b.median_hours         AS "medianResolutionHours"
      FROM org_units u
      LEFT JOIN per_board b ON b.id = u.id
      WHERE u.depth = 1 AND u."isActive"
      ORDER BY u.code
    `,
  ])

  return (rows as BoardRow[]).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    centroidLat: row.centroidLat,
    centroidLon: row.centroidLon,
    // Postgres counts come back as bigint, which JSON.stringify refuses to
    // serialise. Board volumes are five figures, so Number is exact here.
    total: Number(row.total),
    open: Number(row.open),
    closed: Number(row.closed),
    overdue: Number(row.overdue),
    medianResolutionHours:
      row.medianResolutionHours === null ? null : Number(row.medianResolutionHours),
  }))
}

// ---------------------------------------------------------------------------
// The cache, and why this register has one when no other does
// ---------------------------------------------------------------------------
//
// This rollup is an aggregate over 350,000 rows and measured 670ms — over the
// 500ms budget every register is held to. The obvious suspect was bloat from the
// imports that used to rewrite 96,884 rows a run (F-21), but a VACUUM found 77
// dead tuples and changed nothing: the query is simply that much work.
//
// It is also work that almost never needs doing. The imported corpus does not
// change between imports, so the only thing that can move these eighteen rows
// inside this process is a filing or a status change — both of which go through
// `routes/requests.ts`, which calls `invalidateBoards()` after it commits. The
// importer runs in its own process and cannot reach this cache, so the TTL is
// what bounds how long an import can go unseen: one minute.
//
// Invalidation also starts the recomputation immediately rather than leaving it
// to the next reader, and the server warms the cache at boot, so in the steady
// state nobody waits for the aggregate at all.
//
// One race is worth the machinery. A computation that began *before* a write
// can finish *after* it; if it were allowed to populate the cache, the register
// would show the pre-write figures until the TTL ran out — an agent closes a
// request and the board still counts it open. Every write bumps `generation`,
// and a computation only keeps its result if no write happened while it ran.

const TTL_MS = 60_000

// One entry per agency filter, plus the unfiltered borough. Four at most.
const cached = new Map<string, { at: number; body: BoardFigures[] }>()
const inflight = new Map<string, { generation: number; promise: Promise<BoardFigures[]> }>()
let generation = 0

const keyFor = (now: Date, agencyId: number | null) => `${now.toISOString()}|${agencyId ?? 'all'}`

function load(now: Date, agencyId: number | null = null): Promise<BoardFigures[]> {
  const key = keyFor(now, agencyId)
  const running = inflight.get(key)
  if (running && running.generation === generation) return running.promise

  const startedAt = generation
  const promise = compute(now, agencyId).then((body) => {
    if (startedAt === generation) cached.set(key, { at: Date.now(), body })
    return body
  })
  const entry = { generation: startedAt, promise }
  inflight.set(key, entry)
  promise
    .finally(() => {
      if (inflight.get(key) === entry) inflight.delete(key)
    })
    .catch(() => {
      // The reader awaiting `promise` sees the error; this branch only stops an
      // unobserved rejection from being reported twice.
    })
  return promise
}

/** Called after any write that can change a board's figures. */
export function invalidateBoards(): void {
  generation++
  cached.clear()
}

/** Compute in the background so the next reader does not have to wait. */
export function warmBoards(): void {
  load(referenceDate()).catch(() => {
    // A failed warm-up is not an outage: the next reader computes, and sees the
    // real error if there is one.
  })
}

const querySchema = z.object({
  /** One agency's work only. Omitted: every agency's. */
  agencyId: z.coerce.number().int().positive().optional(),
})

/**
 * Public, deliberately (decided in Phase 11).
 *
 * These are counts over NYC Open Data, which New York itself publishes to
 * anyone, and over requests whose status anyone may already look up by number.
 * Nothing here names a person or an address. A resident asking how their board
 * compares is exactly who a rollup like this is for, so the page is public too,
 * and staff see it with their own agency picked.
 */
boardsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const agencyId = parsed.data.agencyId ?? null
    const now = referenceDate()
    // Keyed on the reference date as well, so a system asked to stand
    // somewhere else in time never answers with figures counted from the old
    // vantage point.
    const hit = cached.get(keyFor(now, agencyId))
    const fresh = hit !== undefined && Date.now() - hit.at < TTL_MS
    res.json(fresh ? hit.body : await load(now, agencyId))
  }),
)

/** The rollup as CSV: public, like the page, with the same agency filter. */
boardsRouter.get(
  '/export/csv',
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const rows = await load(referenceDate(), parsed.data.agencyId ?? null)
    sendCsv(
      res,
      'community-boards',
      toCsv(rows, [
        { header: 'Board', value: (r) => r.code },
        { header: 'Name', value: (r) => r.name },
        { header: 'Requests', value: (r) => r.total },
        { header: 'Open', value: (r) => r.open },
        { header: 'Closed', value: (r) => r.closed },
        { header: 'Past derived deadline', value: (r) => r.overdue },
        { header: 'Median hours to close', value: (r) => (r.medianResolutionHours === null ? null : Number(r.medianResolutionHours.toFixed(1))) },
      ]),
    )
  }),
)
