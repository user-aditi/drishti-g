import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { UserRole } from '@prisma/client'
import { env } from '../config/env.js'

const SALT_ROUNDS = 10

export type TokenType = 'access' | 'refresh'

export interface TokenPayload {
  sub: string
  type: TokenType
  role?: UserRole
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  // bcrypt.compare rejects rather than returning false on a malformed hash;
  // a corrupt row in the database should read as a failed login, not a 500.
  return bcrypt.compare(plain, hashed).catch(() => false)
}

export function signToken(userId: number, type: TokenType, role?: UserRole): string {
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
