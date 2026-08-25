import type { NextFunction, Request, Response } from 'express'
import { UserRole } from '@prisma/client'
import { verifyToken } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, forbidden, unauthorized } from '../utils/http.js'

/** Populates req.user, or 401s. */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) throw unauthorized()

    let userId: number
    try {
      userId = Number(verifyToken(header.slice(7), 'access').sub)
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
      fullName: user.fullName,
      role: user.role,
      wardId: user.wardId,
      departmentId: user.departmentId,
    }
    next()
  },
)

/** Gate a route to specific roles. Use after `authenticate`. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized())
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`This action requires: ${roles.join(' or ')}`))
    }
    next()
  }
}

export const requireAdmin = requireRole(UserRole.ADMIN)
export const requireOfficial = requireRole(UserRole.FIELD_OFFICIAL, UserRole.ADMIN)
export const requireCitizen = requireRole(UserRole.CITIZEN)
