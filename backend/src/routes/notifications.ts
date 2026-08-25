import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/http.js'

export const notificationsRouter: Router = Router()

notificationsRouter.use(authenticate)

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
    ])
    res.json({ items, unread })
  }),
)

/** Mark one notification read, scoped to the caller so ids cannot be probed. */
notificationsRouter.post(
  '/:id/read',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const { count } = await prisma.notification.updateMany({
      where: { id: Number(req.params.id), userId: req.user!.id },
      data: { isRead: true },
    })
    res.json({ updated: count })
  }),
)

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true },
    })
    res.json({ updated: count })
  }),
)
