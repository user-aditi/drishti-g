import type { UserRole } from '@prisma/client'

/** The authenticated principal, attached by the auth middleware. */
export interface AuthUser {
  id: number
  email: string
  fullName: string
  role: UserRole
  wardId: number | null
  departmentId: number | null
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export {}
