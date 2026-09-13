import type { NextFunction, Request, Response } from 'express'
import { Role } from '@prisma/client'
import { ACCESS_COOKIE, issuedBeforePasswordChange, verifyToken, type TokenPayload } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, forbidden, unauthorized } from '../utils/http.js'

/** Populates req.user with the caller, or 401s. */
/**
 * The session token a request carries, if any.
 *
 * Two ways in: an Authorization header for API clients and the browser's own
 * fetches, and an httpOnly cookie so Next.js server components can authenticate
 * a request they are rendering without touching localStorage.
 */
function tokenFrom(req: Request): string | null {
  const header = req.headers.authorization
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE]
  return bearer ?? cookie ?? null
}

export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = tokenFrom(req)
    if (!token) throw unauthorized()

    let payload: TokenPayload
    try {
      payload = verifyToken(token, 'access')
    } catch {
      throw unauthorized('Your session is invalid or has expired')
    }

    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } })
    if (!user) throw unauthorized('Your session is invalid or has expired')
    if (issuedBeforePasswordChange(payload, user.passwordChangedAt)) {
      throw unauthorized('Your password was changed — please sign in again')
    }
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
 * Who is asking, on a route anyone may use.
 *
 * Filing is open to everyone, most of whom have no account, so it cannot demand
 * a session. But a signed-in resident's report is theirs. The filing route used
 * to run no authentication at all, so every request filed through the app was
 * recorded as anonymous: a resident never saw their own requests on My requests,
 * and the question asking them to confirm a crew's work could never reach them.
 * Found by the end-to-end tests, which filed as a signed-in resident through the
 * real route; the demo seed had hidden it by writing the reporter directly.
 *
 * A missing, expired or invalid session, or a deactivated account, is simply
 * anonymous here. Refusing a report because of a stale cookie would be worse
 * than filing it without a name.
 */
export const optionalAuthenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = tokenFrom(req)
    if (!token) return next()

    let payload: TokenPayload
    try {
      payload = verifyToken(token, 'access')
    } catch {
      return next()
    }

    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } })
    if (user && user.isActive && !issuedBeforePasswordChange(payload, user.passwordChangedAt)) {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        agencyId: user.agencyId,
        orgUnitId: user.orgUnitId,
        isSynthetic: user.isSynthetic,
      }
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

/*
 * Layer 1's roles are checked with `requireRole(Role.OFFICER)` and
 * `requireRole(Role.SUPERVISOR)` in Layer 1's own routers, not given named
 * guards here: this file is shared, and a baseline file that exported
 * officer-shaped helpers would be a baseline that knows officers exist (N5).
 */
