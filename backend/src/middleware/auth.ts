import type { NextFunction, Request, Response } from 'express'
import { Role } from '@prisma/client'
import { ACCESS_COOKIE, verifyToken } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, forbidden, unauthorized } from '../utils/http.js'

/** Populates req.user with the caller, or 401s. */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    // Two ways in: an Authorization header for API clients and the browser's
    // own fetches, and an httpOnly cookie so Next.js server components can
    // authenticate a request they are rendering without touching localStorage.
    const header = req.headers.authorization
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
    const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE]
    const token = bearer ?? cookie
    if (!token) throw unauthorized()

    let userId: number
    try {
      userId = Number(verifyToken(token, 'access').sub)
    } catch {
      throw unauthorized('Your session is invalid or has expired')
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw unauthorized('Your session is invalid or has expired')
    // Distinct from 401: the token is fine, the account is switched off.
    if (!user.isActive) throw forbidden('This account has been deactivated')

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      agencyId: user.agencyId,
      orgUnitId: user.orgUnitId,
      isSynthetic: user.isSynthetic,
    }
    next()
  },
)

/**
 * Restrict a route to one role.
 *
 * There is no seniority ladder to compare against here, and that is the whole
 * shape of Layer 0: NYC publishes no case-worker identity and no chain of
 * command, so a route is either something a citizen does or something an agency
 * does. The previous system's `requireRank(floor)` compared numeric seniority;
 * reintroducing that before Layer 1 exists would be borrowing our own concept
 * into the baseline (N5).
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized())
    if (!roles.includes(req.user.role)) {
      return next(forbidden('This area is not available to your role'))
    }
    next()
  }
}

export const requireCitizen = requireRole(Role.CITIZEN)

/**
 * An agent, working their agency's queue.
 *
 * Note what this does *not* check: which requests they may touch. An agent's
 * accountability is agency-level, so the scope is the agency and the route
 * handler filters on it. Per-request ownership is a Layer 1 idea.
 */
export const requireAgent = requireRole(Role.AGENT)
