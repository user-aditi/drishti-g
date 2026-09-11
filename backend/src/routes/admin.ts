import { Router } from 'express'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import * as audit from '../services/audit.js'
import { asyncHandler, badRequest } from '../utils/http.js'

/**
 * The administrator's view of the audit chain. Layer 3.
 *
 * Layer 0 already serves the chain and its verification, to agents. These are
 * the same two reads for the administrator, kept here rather than added to Layer
 * 0's routes: a Layer 3 role written into a Layer 0 file is the contamination N5
 * forbids, and the measurement scripts grep for exactly that.
 */
export const adminRouter: Router = Router()
adminRouter.use(authenticate, requireRole(Role.ADMIN))

adminRouter.get(
  '/audit/verify',
  asyncHandler(async (_req, res) => {
    const result = await audit.verifyChain(prisma)
    res.json({
      ok: result.valid,
      checked: result.checked,
      head: result.head ?? null,
      brokenAt: result.brokenAtId ?? null,
      reason: result.reason ?? null,
    })
  }),
)

const listSchema = z.object({
  action: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data
    const where = q.action ? { action: q.action } : {}

    const [rows, total, actions] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          actorLabel: true,
          source: true,
          payload: true,
          hash: true,
          prevHash: true,
          createdAt: true,
        },
      }),
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
    ])

    res.json({
      rows,
      total,
      page: q.page,
      pageSize: q.pageSize,
      actions: actions.map((a) => ({ action: a.action, count: a._count._all })),
    })
  }),
)
