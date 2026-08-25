/**
 * Departments, wards, and categories.
 *
 * Reads are open to any signed-in user — a citizen filing a complaint needs the
 * category and ward lists. Writes are admin-only.
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { asyncHandler } from '../utils/http.js'

export const orgRouter: Router = Router()

orgRouter.use(authenticate)

orgRouter.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.department.findMany({ orderBy: { name: 'asc' } }))
  }),
)

orgRouter.get(
  '/wards',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.ward.findMany({ orderBy: { wardNumber: 'asc' } }))
  }),
)

orgRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.complaintCategory.findMany({
        include: { department: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
    )
  }),
)

const wardSchema = z.object({
  wardNumber: z.number().int().positive(),
  name: z.string().min(2).max(128),
  zone: z.string().max(64).optional(),
  population: z.number().int().positive().optional(),
  centroidLat: z.number().min(-90).max(90).optional(),
  centroidLon: z.number().min(-180).max(180).optional(),
})

orgRouter.post(
  '/wards',
  requireAdmin,
  validate(wardSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof wardSchema>
    const actor = req.user!

    const ward = await prisma.$transaction(async (tx) => {
      const created = await tx.ward.create({ data: body })
      await audit.record(tx, {
        action: 'ward.created',
        entityType: 'ward',
        entityId: created.id,
        payload: { ...body },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return created
    })

    res.status(201).json(ward)
  }),
)

const departmentSchema = z.object({
  code: z.string().min(2).max(16).transform((c) => c.toUpperCase()),
  name: z.string().min(2).max(128),
  description: z.string().max(500).optional(),
})

orgRouter.post(
  '/departments',
  requireAdmin,
  validate(departmentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof departmentSchema>
    const actor = req.user!

    const department = await prisma.$transaction(async (tx) => {
      const created = await tx.department.create({ data: body })
      await audit.record(tx, {
        action: 'department.created',
        entityType: 'department',
        entityId: created.id,
        payload: { ...body },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return created
    })

    res.status(201).json(department)
  }),
)
