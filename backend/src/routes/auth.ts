import { Router } from 'express'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { REFRESH_COOKIE, hashPassword, signToken, verifyPassword, verifyToken } from '../lib/auth.js'
import { clearAuthCookies, setAuthCookies } from '../lib/cookies.js'
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
  name: z.string().min(2, 'Enter your name').max(128),
  phone: z.string().max(20).optional(),
  /** The board the person lives in. Pre-fills intake; it is not an authority scope. */
  orgUnitId: z.number().int().positive().nullable().optional(),
})

const loginSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1, 'Enter your password'),
})

const USER_INCLUDE = { agency: true, orgUnit: true } as const

function tokensFor(user: { id: number; role: Role }) {
  return {
    accessToken: signToken(user.id, 'access', user.role),
    refreshToken: signToken(user.id, 'refresh'),
  }
}

/**
 * Public self-registration. Always creates a citizen.
 *
 * Agent accounts are seeded, never self-registered — otherwise anyone could sign
 * themselves into an agency queue. Layer 0 has only these two roles, because NYC
 * publishes no case-worker identity to model anything finer on.
 */
authRouter.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>

    const existing = await prisma.user.findUnique({ where: { email: body.email } })
    if (existing) throw conflict('An account with this email already exists')

    const passwordHash = await hashPassword(body.password)
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email,
          passwordHash,
          name: body.name,
          phone: body.phone ?? null,
          role: Role.CITIZEN,
          orgUnitId: body.orgUnitId ?? null,
          // A real person signed up. Only the seeded staff accounts stand in for
          // a role NYC does not record.
          isSynthetic: false,
        },
      })
      await audit.record(tx, {
        action: 'user.registered',
        entityType: 'user',
        entityId: created.id,
        payload: { email: created.email, role: created.role },
        actorId: created.id,
        actorLabel: created.name,
      })
      return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: USER_INCLUDE })
    })

    const tokens = tokensFor(user)
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken)
    res.status(201).json({ ...tokens, user: publicUser(user) })
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
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
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
        actorLabel: user.name,
      }),
    )

    const tokens = tokensFor(user)
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken)
    res.json({ ...tokens, user: publicUser(user) })
  }),
)

authRouter.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(1).optional() })),
  asyncHandler(async (req, res) => {
    const body = req.body as { refreshToken?: string }
    const cookies = req.cookies as Record<string, string> | undefined
    const refreshToken = body.refreshToken ?? cookies?.[REFRESH_COOKIE]
    if (!refreshToken) throw unauthorized('Your session has expired — please sign in again')

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

    const accessToken = signToken(user.id, 'access', user.role)
    setAuthCookies(res, accessToken)
    res.json({ accessToken })
  }),
)

/** Clears the session cookies. The client also drops its own copy of the tokens. */
authRouter.post('/logout', (_req, res) => {
  clearAuthCookies(res)
  res.json({ ok: true })
})

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
