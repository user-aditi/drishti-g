import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { graphHealth } from '../lib/neo4j.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { fullSync } from '../services/graphSync.js'
import { asyncHandler } from '../utils/http.js'

export const systemRouter: Router = Router()

/**
 * Unauthenticated liveness check, reporting each dependency separately so a
 * failure points at which one is down.
 */
systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let postgres = { ok: true, detail: 'ok' }
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (err) {
      postgres = { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }

    const neo4j = await graphHealth()
    res.json({
      status: postgres.ok && neo4j.ok ? 'ok' : 'degraded',
      postgres,
      neo4j,
    })
  }),
)

/** Rebuild the Neo4j projection from Postgres. Idempotent. */
systemRouter.post(
  '/graph/sync',
  authenticate,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ synced: await fullSync() })
  }),
)
