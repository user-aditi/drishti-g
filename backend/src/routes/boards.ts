import { Router } from 'express'
import { referenceDate } from '../config/systemClock.js'
import { prisma } from '../lib/prisma.js'
import { asyncHandler } from '../utils/http.js'

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

/**
 * Memory for the percentile's sort.
 *
 * `PERCENTILE_CONT` is an ordered-set aggregate, so it has to sort every closed
 * request in a board before it can pick the middle one — about 350,000 rows and
 * 28MB of working set across the borough. At Postgres's default 4MB `work_mem`
 * that sort spills to disk and the query takes 466ms; in memory it is closer to
 * 250ms, which is the difference between this register meeting its budget and
 * missing it.
 *
 * Set with `SET LOCAL` inside the transaction, so it applies to this one query
 * and is released with it rather than being raised server-wide for every
 * connection in the pool.
 */
const SORT_MEMORY = '64MB'

/**
 * Volume, resolution time and backlog for each of Brooklyn's 18 community boards.
 *
 * Three things about this query are deliberate.
 *
 * **A median, not a mean.** Resolution times are violently skewed — Street Light
 * Condition has a p50 of 139 hours against a p90 of 1,881 — so a mean reports a
 * number no request actually experienced and lurches whenever one streetlight
 * sits open for two years. `PERCENTILE_CONT` is also the one aggregate Prisma
 * cannot express, which is why this is raw SQL.
 *
 * **The aggregate runs first, then joins.** Grouping the join of `org_units` to
 * 355,000 requests makes the planner sort the whole joined set; aggregating by
 * `orgUnitId` first and joining eighteen resulting rows to their boards does the
 * same work on narrower tuples and measured about 15% faster. The `LEFT JOIN`
 * stays, because a board with no requests is a real answer that has to appear —
 * dropping it would make this register silently disagree with the borough total.
 *
 * **`overdue` is counted against the system reference date.** Never
 * `Date.now()`: this corpus ends in December 2025, and the wall clock would
 * report every board as entirely overdue.
 */
boardsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const now = referenceDate()

    const [, rows] = await prisma.$transaction([
      prisma.$executeRawUnsafe(`SET LOCAL work_mem = '${SORT_MEMORY}'`),
      prisma.$queryRaw<BoardRow[]>`
        WITH per_board AS (
          SELECT r."orgUnitId" AS id,
                 COUNT(*)                                        AS total,
                 COUNT(*) FILTER (WHERE r.status <> 'CLOSED')     AS open,
                 COUNT(*) FILTER (WHERE r.status = 'CLOSED')      AS closed,
                 COUNT(*) FILTER (
                   WHERE r."closedAt" IS NULL AND r."slaDueAt" < ${now}
                 )                                                AS overdue,
                 PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM (r."closedAt" - r."createdAt")) / 3600.0
                 ) FILTER (WHERE r."closedAt" IS NOT NULL)        AS median_hours
          FROM service_requests r
          WHERE r."orgUnitId" IS NOT NULL
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

    res.json(
      (rows as BoardRow[]).map((row) => ({
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
      })),
    )
  }),
)
