import type { NextFunction, Request, Response } from 'express'
import { Rank } from '@prisma/client'
import { ACCESS_COOKIE, verifyToken } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { RANK_LEVEL, isOfficer } from '../services/hierarchy.js'
import { asyncHandler, forbidden, unauthorized } from '../utils/http.js'

/** Populates req.user with the caller and their active postings, or 401s. */
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        postings: {
          where: { endedAt: null },
          include: { department: true, zone: true, circle: true, sector: true },
        },
      },
    })
    if (!user) throw unauthorized('Your session is invalid or has expired')
    // Distinct from 401: the token is fine, the account is switched off.
    if (!user.isActive) throw forbidden('This account has been deactivated')

    const primary = user.postings.find((p) => p.isPrimary) ?? user.postings[0]

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      rank: user.rank,
      homeSectorId: user.homeSectorId,
      departmentId: primary?.departmentId ?? null,
      sectorId: primary?.sectorId ?? null,
      circleId: primary?.circleId ?? null,
      zoneId: primary?.zoneId ?? null,
      designationTitle: primary?.designationTitle ?? null,
      trade: primary?.trade ?? null,
      postings: user.postings.map((p) => ({
        id: p.id,
        departmentId: p.departmentId,
        rank: p.rank,
        level: p.level,
        zoneId: p.zoneId,
        circleId: p.circleId,
        sectorId: p.sectorId,
        designationTitle: p.designationTitle,
        trade: p.trade,
      })),
    }
    next()
  },
)

/**
 * Require a minimum seniority.
 *
 * Rank alone is never sufficient for a write — jurisdiction is checked
 * separately by `hasJurisdiction`, because an Executive Engineer in Zone II has
 * no business acting in Zone I.
 */
export function requireRank(floor: Rank) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized())
    if (RANK_LEVEL[req.user.rank] < RANK_LEVEL[floor]) {
      return next(forbidden(`This action requires ${floor.replace(/_/g, ' ').toLowerCase()} or above`))
    }
    next()
  }
}

/** Restrict to an explicit set of ranks — for screens that are role-specific rather than seniority-gated. */
export function requireExactRank(...ranks: Rank[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized())
    if (!ranks.includes(req.user.rank)) {
      return next(forbidden('This area is not available to your role'))
    }
    next()
  }
}

export const requireOfficer = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized())
  if (!isOfficer(req.user.rank)) {
    return next(forbidden('This action is restricted to officers'))
  }
  next()
}

export const requireSectionOfficer = requireRank(Rank.SECTION_OFFICER)
export const requireCircleOfficer = requireRank(Rank.CIRCLE_OFFICER)
export const requireHod = requireRank(Rank.HOD)
export const requireSuperAdmin = requireRank(Rank.SUPER_ADMIN)
