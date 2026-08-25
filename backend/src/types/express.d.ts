import type { JurisdictionLevel, Rank, Trade } from '@prisma/client'

export interface AuthPosting {
  id: number
  departmentId: number | null
  rank: Rank
  level: JurisdictionLevel
  zoneId: number | null
  circleId: number | null
  sectorId: number | null
  designationTitle: string | null
  trade: Trade | null
}

/** The authenticated principal, attached by the auth middleware. */
export interface AuthUser {
  id: number
  email: string
  fullName: string
  rank: Rank
  homeSectorId: number | null
  /** Flattened from the primary posting for convenience. */
  departmentId: number | null
  sectorId: number | null
  circleId: number | null
  zoneId: number | null
  designationTitle: string | null
  trade: Trade | null
  /** Every active posting — the source of truth for jurisdiction. */
  postings: AuthPosting[]
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export {}
