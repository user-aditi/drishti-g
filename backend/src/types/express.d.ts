import type { Role } from '@prisma/client'

/**
 * The authenticated principal, attached by the auth middleware.
 *
 * Flat, and deliberately so. The previous system carried a list of postings
 * here because authority was a position in a chain of command; in Layer 0 an
 * agent is accountable *as their agency* and nothing finer, which is exactly
 * how NYC 311 works. Individual ownership arrives with Layer 1 and will need a
 * posting again — but inventing it now would contaminate the baseline every
 * later layer is measured against.
 */
export interface AuthUser {
  id: number
  email: string
  name: string
  role: Role
  /** The agency an agent works for. Null for citizens. */
  agencyId: number | null
  /** A citizen's home board. Used to pre-fill intake, never to scope authority. */
  orgUnitId: number | null
  /** True for accounts standing in for a role NYC does not record. */
  isSynthetic: boolean
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export {}
