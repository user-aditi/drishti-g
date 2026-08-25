import { Router } from 'express'
import { Rank } from '@prisma/client'
import { z } from 'zod'
import { hashPassword, signToken, verifyPassword, verifyToken } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { asyncHandler, conflict, unauthorized } from '../utils/http.js'
import { publicUser } from '../utils/serialize.js'

export const authRouter: Router = Router()

const registerSchema = z.object({
  email: z.string().email('Enter a valid email address').transform((e) => e.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Enter your full name').max(128),
  phone: z.string().max(20).optional(),
  homeSectorId: z.number().int().positive().nullable().optional(),
})

const loginSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1, 'Enter your password'),
})

const USER_INCLUDE = {
  homeSector: true,
  postings: {
    where: { endedAt: null },
    include: { department: true, zone: true, circle: true, sector: true },
  },
} as const

function tokensFor(user: { id: number; rank: Rank }) {
  return {
    accessToken: signToken(user.id, 'access', user.rank),
    refreshToken: signToken(user.id, 'refresh'),
  }
}

/**
 * Public self-registration. Always creates a citizen.
 *
 * Officials and admins are provisioned by an admin through /users — otherwise
 * anyone could sign themselves up with elevated access.
 */
authRouter.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>

    const existing = await prisma.user.findUnique({ where: { email: body.email } })
    if (existing) throw conflict('An account with this email already exists')

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email,
          hashedPassword: await hashPassword(body.password),
          fullName: body.fullName,
          phone: body.phone ?? null,
          rank: Rank.CITIZEN,
          homeSectorId: body.homeSectorId ?? null,
        },
      })
      await audit.record(tx, {
        action: 'user.registered',
        entityType: 'user',
        entityId: created.id,
        payload: { email: created.email, rank: created.rank },
        actorId: created.id,
        actorLabel: created.fullName,
      })
      return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: USER_INCLUDE })
    })

    res.status(201).json({ ...tokensFor(user), user: publicUser(user) })
  }),
)

authRouter.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>

    const user = await prisma.user.findUnique({ where: { email }, include: USER_INCLUDE })
    // One message for both "no such user" and "wrong password", so this endpoint
    // cannot be used to discover which emails are registered.
    if (!user || !(await verifyPassword(password, user.hashedPassword))) {
      throw unauthorized('Incorrect email or password')
    }
    if (!user.isActive) throw unauthorized('This account has been deactivated')

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        payload: { email: user.email },
        actorId: user.id,
        actorLabel: user.fullName,
      }),
    )

    res.json({ ...tokensFor(user), user: publicUser(user) })
  }),
)

authRouter.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string }

    let userId: number
    try {
      userId = Number(verifyToken(refreshToken, 'refresh').sub)
    } catch {
      throw unauthorized('Your session has expired — please sign in again')
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.isActive) {
      throw unauthorized('Your session has expired — please sign in again')
    }

    res.json({ accessToken: signToken(user.id, 'access', user.rank) })
  }),
)

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      include: USER_INCLUDE,
    })
    res.json(publicUser(user))
  }),
)
