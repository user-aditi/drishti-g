import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { Role } from '@prisma/client'
import { env } from '../config/env.js'

const SALT_ROUNDS = 10

export type TokenType = 'access' | 'refresh'

/**
 * Cookie names.
 *
 * The tokens are also returned in the response body for API clients, but the
 * cookies are what let a Next.js server component authenticate a request it is
 * rendering — server components cannot read localStorage.
 */
export const ACCESS_COOKIE = 'drishti_access'
export const REFRESH_COOKIE = 'drishti_refresh'

export interface TokenPayload {
  sub: string
  type: TokenType
  role?: Role
  /** Seconds since the epoch, set by the signer. */
  iat?: number
}

/**
 * Whether a session predates the account's last password change.
 *
 * Tokens have no server-side record to revoke, so a password change instead
 * refuses anything issued before it. Compared in whole seconds, the resolution
 * `iat` has, so the session issued in the same second as the change survives.
 */
export function issuedBeforePasswordChange(payload: TokenPayload, changedAt: Date | null): boolean {
  if (!changedAt || payload.iat === undefined) return false
  return payload.iat < Math.floor(changedAt.getTime() / 1000)
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  // bcrypt.compare rejects rather than returning false on a malformed hash;
  // a corrupt row in the database should read as a failed login, not a 500.
  return bcrypt.compare(plain, hashed).catch(() => false)
}

export function signToken(userId: number, type: TokenType, role?: Role): string {
  const payload: TokenPayload = { sub: String(userId), type, ...(role ? { role } : {}) }
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: type === 'access' ? env.ACCESS_TOKEN_TTL : env.REFRESH_TOKEN_TTL,
  } as jwt.SignOptions)
}

/**
 * Decode a token and confirm it is the *kind* we expect.
 *
 * Without the type check, a long-lived refresh token would work as a bearer
 * token, handing out a session that effectively never expires.
 */
export function verifyToken(token: string, expected: TokenType): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload
  if (decoded.type !== expected) {
    throw new jwt.JsonWebTokenError(`Expected a ${expected} token`)
  }
  return decoded
}

/**
 * A short-lived permission to attach photographs to one request.
 *
 * Most people file without an account, so there is nobody to authenticate when
 * their photograph follows the filing a moment later. The filing response hands
 * them this instead: it names one request, and it expires in an hour.
 */
export function signRequestPhotoToken(requestId: number): string {
  return jwt.sign({ sub: String(requestId), type: 'request-photo' }, env.JWT_SECRET, { expiresIn: '1h' })
}

/** The request a photo token was issued for, or null if it is invalid, expired or another kind of token. */
export function verifyRequestPhotoToken(token: string): number | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { sub?: string; type?: string }
    if (decoded.type !== 'request-photo') return null
    const id = Number(decoded.sub)
    return Number.isInteger(id) ? id : null
  } catch {
    return null
  }
}
