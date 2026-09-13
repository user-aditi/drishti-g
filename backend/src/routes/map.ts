import { Router } from 'express'
import { z } from 'zod'
import { RequestStatus } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

import { asyncHandler, badRequest } from '../utils/http.js'

export const mapRouter: Router = Router()

const clusterSchema = z.object({
  /** west,south,east,north */
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/),
  zoom: z.coerce.number().int().min(0).max(20).default(12),
  openOnly: z.coerce.boolean().default(true),
  agencyId: z.coerce.number().int().positive().optional(),
})

/**
 * Grid size in degrees for a given zoom level.
 *
 * Clustering happens in the database, not the browser, and that is a hard
 * requirement rather than an optimisation. Brooklyn holds ~350,000 requests with
 * coordinates; shipping them to Leaflet and clustering client-side means a
 * 40MB response and a tab that stops responding. The build plan marks the map a
 * blocker for exactly this reason.
 *
 * Snapping to a grid is the cheapest clustering that is still honest: every
 * point lands in exactly one cell, cells are stable as you pan (unlike
 * distance-based clustering, where the same point joins a different cluster
 * depending on which rows arrived first), and the count is exact. Cells halve
 * with each zoom step so a cluster breaks apart as you go in.
 */
function gridSize(zoom: number): number {
  // A web-map tile spans 360/2^zoom degrees, so this is a tile quartered: about
  // 10km at zoom 8, 1.2km at 12, and 40m by zoom 18.
  //
  // The divisor is the whole design of this map and it was tuned against the
  // real corpus rather than picked. At a tile split sixteen ways, Brooklyn at
  // borough zoom came back as 527 cells — a uniform lattice of small numbers
  // covering the landmass, which is a picture of the grid and not of the work.
  // The map exists to answer "where is this piling up", and that needs cells
  // large enough that their counts differ visibly from their neighbours'.
  //
  // Quartering gives a few dozen cells across the borough at opening zoom, and
  // still separates two reports on the same street once you are close enough to
  // tell them apart.
  return 360 / 2 ** (zoom + 2)
}

/**
 * Public, like the board rollup (Phase 11): counts per cell, never a request,
 * over locations NYC Open Data already publishes with every row. The agency is a
 * filter the caller chooses, not a scope inferred from who is asking, so the same
 * query gives everyone the same answer.
 */
mapRouter.get(
  '/clusters',
  asyncHandler(async (req, res) => {
    const parsed = clusterSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid map query', parsed.error.flatten())
    const { bbox, zoom, openOnly, agencyId } = parsed.data

    const [west, south, east, north] = bbox.split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ]
    if (west >= east || south >= north) throw badRequest('bbox must be west,south,east,north')

    const size = gridSize(zoom)
    const agencyFilter = agencyId ?? null

    const rows = await prisma.$queryRaw<
      { lat: number; lng: number; count: bigint }[]
    >`
      SELECT
        FLOOR(r.latitude  / ${size}) * ${size} + ${size} / 2 AS lat,
        FLOOR(r.longitude / ${size}) * ${size} + ${size} / 2 AS lng,
        COUNT(*) AS count
      FROM service_requests r
      WHERE r.latitude IS NOT NULL
        AND r.longitude IS NOT NULL
        AND r.latitude  BETWEEN ${south} AND ${north}
        AND r.longitude BETWEEN ${west}  AND ${east}
        AND (${openOnly}::boolean = false OR r.status <> ${RequestStatus.CLOSED}::"RequestStatus")
        AND (${agencyFilter}::int IS NULL OR r."agencyId" = ${agencyFilter}::int)
      GROUP BY 1, 2
      ORDER BY count DESC
      LIMIT 2000
    `

    res.json(
      rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), count: Number(r.count) })),
    )
  }),
)
