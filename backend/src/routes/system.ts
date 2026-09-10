import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { referenceDate } from '../config/systemClock.js'
import { asyncHandler } from '../utils/http.js'

export const systemRouter: Router = Router()

/**
 * The community boards someone can say they live in.
 *
 * Deliberately unauthenticated: someone registering has to pick a board before
 * they have an account, and a picker that silently comes back empty is how
 * people end up with no home area and a blank intake form.
 *
 * Leaves only. A resident lives in a community board, not in a borough.
 */
systemRouter.get(
  '/areas',
  asyncHandler(async (_req, res) => {
    const areas = await prisma.orgUnit.findMany({
      where: { isLeaf: true, isActive: true },
      select: { id: true, name: true, code: true, kindLabel: true },
      orderBy: { code: 'asc' },
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
      // Surfaced because almost every date on every screen is read against it
      // rather than against the wall clock, and an operator looking at an
      // "overdue" count needs to know which day the system thinks it is.
      referenceDate: referenceDate(),
    })
  }),
)
