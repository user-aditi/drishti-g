import { Router } from 'express'
import { Role } from '@prisma/client'
import { z } from 'zod'
import {
  REFRESH_COOKIE,
  hashPassword,
  issuedBeforePasswordChange,
  signToken,
  verifyPassword,
  verifyToken,
  type TokenPayload,
} from '../lib/auth.js'
import { clearAuthCookies, setAuthCookies } from '../lib/cookies.js'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { asyncHandler, badRequest, conflict, unauthorized } from '../utils/http.js'
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
  rateLimit({
    bucket: 'register',
    windowMs: 60_000,
    max: 10,
    message: 'Too many accounts created from here in the last minute. Wait a moment and try again.',
  }),
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
  // Without this a password could be guessed as fast as a script can ask.
  rateLimit({
    bucket: 'login',
    windowMs: 60_000,
    max: 20,
    message: 'Too many sign-in attempts from here. Wait a minute and try again.',
  }),
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

    let payload: TokenPayload
    try {
      payload = verifyToken(refreshToken, 'refresh')
    } catch {
      throw unauthorized('Your session has expired — please sign in again')
    }

    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } })
    if (!user || !user.isActive || issuedBeforePasswordChange(payload, user.passwordChangedAt)) {
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

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(128),
  phone: z.string().trim().max(20).nullable().optional(),
  /** A resident's home board, used to pre-fill filing. */
  orgUnitId: z.number().int().positive().nullable().optional(),
})

/**
 * Change your own name, phone and home board.
 *
 * Not email, which is the sign-in identity, and not role or agency, which are
 * never a person's to set for themselves.
 */
authRouter.patch(
  '/me',
  authenticate,
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof profileSchema>
    if (body.orgUnitId != null) {
      const unit = await prisma.orgUnit.findUnique({ where: { id: body.orgUnitId } })
      if (!unit || !unit.isActive) throw badRequest('That community board does not exist')
    }
    const user = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: req.user!.id },
        data: {
          name: body.name,
          ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
          ...(body.orgUnitId !== undefined ? { orgUnitId: body.orgUnitId } : {}),
        },
      })
      await audit.record(tx, {
        action: 'user.profile_updated',
        entityType: 'user',
        entityId: req.user!.id,
        // What changed, not the values: a phone number does not belong on a
        // permanent, hash-chained record.
        payload: { fields: Object.keys(body) },
        actorId: req.user!.id,
        actorLabel: body.name,
      })
      return tx.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: USER_INCLUDE })
    })
    res.json(publicUser(user))
  }),
)

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(8, 'The new password must be at least 8 characters'),
})

/**
 * Change your password, and sign every other session out.
 *
 * The current password is required even with a valid session: a session left
 * open on a shared computer should not be enough to take the account over. The
 * session that made the change gets fresh tokens, issued after the change, so it
 * stays signed in while every older one is refused.
 */
authRouter.post(
  '/password',
  rateLimit({
    bucket: 'password',
    windowMs: 60_000,
    max: 5,
    message: 'Too many password attempts from here. Wait a minute and try again.',
  }),
  authenticate,
  validate(passwordSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof passwordSchema>
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } })
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw unauthorized('Your current password is not correct')
    }
    if (body.currentPassword === body.newPassword) {
      throw badRequest('Choose a password different from the current one')
    }

    // Whole seconds, matching a token's `iat`, so the fresh tokens below are not
    // themselves refused as older than the change.
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000)
    const passwordHash = await hashPassword(body.newPassword)
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: changedAt } })
      await audit.record(tx, {
        action: 'user.password_changed',
        entityType: 'user',
        entityId: user.id,
        payload: {},
        actorId: user.id,
        actorLabel: user.name,
      })
    })

    const tokens = tokensFor(user)
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken)
    res.json({ ok: true, ...tokens })
  }),
)
