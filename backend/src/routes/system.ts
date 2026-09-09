import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler } from '../utils/http.js'

export const systemRouter: Router = Router()

/**
 * The areas a resident can say they live in.
 *
 * Deliberately unauthenticated: someone registering has to choose their area
 * before they have an account, and a picker that silently comes back empty is
 * how people end up with no home area and a blank neighbourhood page.
 *
 * Only ground-floor units are offered — a resident lives on a street, not in a
 * zone, and routing dispatches from the ground floor.
 */
systemRouter.get(
  '/areas',
  asyncHandler(async (_req, res) => {
    const areas = await prisma.orgUnit.findMany({
      where: { isLeaf: true, isActive: true },
      select: { id: true, name: true, code: true, kindLabel: true },
      orderBy: { name: 'asc' },
    })
    res.json(areas)
  }),
)

systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let postgres = { ok: true, detail: 'ok' }
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (err) {
      postgres = { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }

    res.json({
      status: postgres.ok ? 'ok' : 'degraded',
      postgres,
    })
  }),
)

