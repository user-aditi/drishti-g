import { Router } from 'express'
import { Role } from '@prisma/client'
import { authenticate, requireRole } from '../middleware/auth.js'
import { loadSpec, type SpecEnvelope } from '../services/modelSpec.js'
import { asyncHandler, notFound } from '../utils/http.js'

/**
 * GCCE's routing report. Layer 3 — and a report, not a router.
 *
 * GCCE was meant to decide which agency a request goes to, and to be measured
 * against the agency NYC actually assigned. Measured, there is almost nothing to
 * decide: NYC's complaint types are agency-scoped, so choosing the type chooses
 * the agency for 184 of 188 Brooklyn types. On the four shared ones, a lookup
 * table beats always choosing the usual agency only where NYC's own descriptor
 * already names the agency (Asbestos, Graffiti); on Encampment and Highway
 * Condition nothing known at intake does better than the usual agency.
 *
 * The decision of 11 September 2026 was to report that rather than import the
 * four types and route them live (F-23). So nothing here executes the table:
 * this endpoint serves what research/drishti_research/nyc_routing.py measured,
 * and the table it learned, for the page that shows both.
 */
export const routingRouter: Router = Router()

/** Bump with CONTRACT in nyc_routing.py. */
export const GCCE_CONTRACT = 'gcce-table/1'

interface RoutingSpec extends SpecEnvelope {
  trainedAt: string
  chosen: string
  types: string[]
  chain: string[][]
  minSupport: number
  cells: { level: number; type: string; values: string[]; agency: string; support: number; share: number }[]
  evaluation: {
    trainedOn: string
    testYear: number
    testRows: number
    accuracy: Record<string, number>
    validation: Record<string, number>
    perType: Record<string, { rows: number; modal: number; chosen: number }>
    gainOverModal: { gain: number; ciLow: number; ciHigh: number }
    gatePassed: boolean
  }
}

routingRouter.get(
  '/accuracy',
  authenticate,
  requireRole(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const spec = loadSpec<RoutingSpec>('gcce-spec.json', GCCE_CONTRACT)
    if (!spec) throw notFound('No routing measurement has been exported. Run python -m drishti_research.nyc_routing')
    res.json({
      modelVersion: spec.modelVersion,
      trainedAt: spec.trainedAt,
      chosen: spec.chosen,
      chain: spec.chain,
      minSupport: spec.minSupport,
      evaluation: spec.evaluation,
      // The learned table, richest key first, most-supported first within it.
      cells: [...spec.cells].sort((a, b) => a.type.localeCompare(b.type) || a.level - b.level || b.support - a.support),
      scope: {
        typesMeasured: spec.types,
        brooklynTypes2024: 188,
        sharedTypes2024: 4,
        sharedShareOfRequests2024: 0.019,
      },
    })
  }),
)
