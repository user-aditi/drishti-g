import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler, badRequest, notFound } from '../utils/http.js'

/**
 * A person's own notifications. Anyone signed in; nobody else's.
 */
export const notificationsRouter: Router = Router()
notificationsRouter.use(authenticate)

const listSchema = z.object({
  unreadOnly: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
})

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data
    const mine = { userId: req.user!.id }
    const where = q.unreadOnly === 'true' ? { ...mine, readAt: null } : mine

    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...mine, readAt: null } }),
    ])
    res.json({ rows, total, unread, page: q.page, pageSize: q.pageSize })
  }),
)

/** How many are unread — for the header, on every page, so nothing else. */
notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    res.json({ unread: await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }) })
  }),
)

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('Invalid notification id')
    // Scoped to the caller in the write itself: someone else's id updates nothing.
    const { count } = await prisma.notification.updateMany({
      where: { id, userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    })
    if (count === 0) {
      const exists = await prisma.notification.findFirst({ where: { id, userId: req.user!.id } })
      if (!exists) throw notFound('No such notification')
    }
    res.json({ ok: true })
  }),
)

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    })
    res.json({ ok: true, marked: count })
  }),
)
