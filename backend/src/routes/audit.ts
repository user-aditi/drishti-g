import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireAgent } from '../middleware/auth.js'
import * as audit from '../services/audit.js'
import { asyncHandler, badRequest } from '../utils/http.js'

export const auditRouter: Router = Router()

/**
 * Walk the hash chain and report whether it verifies.
 *
 * This is the endpoint that makes the tamper-evidence claim checkable rather
 * than asserted, so it reports the first row that fails and why, not a bare
 * boolean. Two distinct failures are worth telling apart: an entry that does not
 * link to its predecessor means a record was removed or reordered, and one whose
 * contents no longer match its fingerprint means it was edited in place.
 *
 * Note what the chain does *not* contain. An imported request has one entry
 * saying it was imported, and no invented "assigned" or "closed" events —
 * fabricating those would make everything else in here worthless.
 */
auditRouter.get(
  '/verify',
  authenticate,
  requireAgent,
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
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

/** The chain itself, newest first, for the audit viewer. */
auditRouter.get(
  '/',
  authenticate,
  requireAgent,
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data

    const where = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
    }

    const [rows, total] = await Promise.all([
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
    ])

    res.json({ rows, total, page: q.page, pageSize: q.pageSize })
  }),
)
