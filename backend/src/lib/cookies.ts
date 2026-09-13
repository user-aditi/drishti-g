import type { CookieOptions, Response } from 'express'
import { env } from '../config/env.js'
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.js'

/**
 * httpOnly so no script can read them, sameSite lax so ordinary navigation
 * carries them. Cookies ignore the port, so one set on localhost is visible to
 * both the API on 4000 and the Next server on 3000 during development.
 */
function baseOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

export function setAuthCookies(res: Response, accessToken: string, refreshToken?: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, baseOptions(HOUR))
  if (refreshToken) res.cookie(REFRESH_COOKIE, refreshToken, baseOptions(14 * DAY))
}

export function clearAuthCookies(res: Response): void {
  const options: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, path: '/' }
  res.clearCookie(ACCESS_COOKIE, options)
  res.clearCookie(REFRESH_COOKIE, options)
}
