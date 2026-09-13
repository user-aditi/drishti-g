import { Router } from 'express'
import { RequestStatus, Role } from '@prisma/client'
import { env } from '../config/env.js'
import { referenceDate } from '../config/systemClock.js'
import { jobRuns } from '../lib/jobRuns.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { declaredSpecs } from '../services/modelSpec.js'
import { asyncHandler } from '../utils/http.js'

/**
 * The state of the running system, on one page, for the administrator.
 *
 * Every figure here answers a question that otherwise needs a terminal: which
 * day does the system think it is, which trained models did it actually load,
 * are the sweeps running or did one die at boot, how long is the audit chain.
 * The public `/health` stays public and small; this is the full picture.
 *
 * The chain is reported by length and head, not verified: verification walks
 * every entry and belongs on the audit page, where someone has asked for it.
 */
export const adminSystemRouter: Router = Router()
adminSystemRouter.use(authenticate, requireRole(Role.ADMIN))

const startedAt = new Date()

adminSystemRouter.get(
  '/system',
  asyncHandler(async (_req, res) => {
    let postgres = { ok: true, detail: 'ok' }
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (err) {
      postgres = { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }

    const [requests, imported, open, users, postings, chainLength, head] = await Promise.all([
      prisma.serviceRequest.count(),
      prisma.serviceRequest.count({ where: { isImported: true } }),
      prisma.serviceRequest.count({ where: { status: { not: RequestStatus.CLOSED } } }),
      prisma.user.groupBy({ by: ['role', 'isActive'], _count: { _all: true } }),
      prisma.posting.count({ where: { endedAt: null } }),
      prisma.auditEvent.count(),
      prisma.auditEvent.findFirst({ orderBy: { id: 'desc' }, select: { id: true, hash: true, createdAt: true, action: true } }),
    ])

    const byRole = new Map<string, { active: number; inactive: number }>()
    for (const row of users) {
      const entry = byRole.get(row.role) ?? { active: 0, inactive: 0 }
      entry[row.isActive ? 'active' : 'inactive'] += row._count._all
      byRole.set(row.role, entry)
    }

    const reference = referenceDate()
    res.json({
      status: postgres.ok ? 'ok' : 'degraded',
      postgres,
      clock: {
        referenceDate: reference,
        wallClock: new Date(),
        // Imported rows are judged at the corpus snapshot, live rows at the real
        // clock (N9). Said plainly, because it is the first thing that confuses
        // someone reading an "overdue" count.
        rule: 'Imported requests are judged at the reference date; requests filed here, at the real clock.',
      },
      process: {
        nodeEnv: env.NODE_ENV,
        startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
      },
      specs: declaredSpecs(),
      jobs: jobRuns(),
      corpus: { requests, imported, live: requests - imported, open },
      people: {
        byRole: [...byRole.entries()].map(([role, counts]) => ({ role, ...counts })),
        activePostings: postings,
      },
      chain: { length: chainLength, head: head ?? null },
    })
  }),
)
