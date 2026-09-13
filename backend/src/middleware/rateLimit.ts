import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { AppError } from '../utils/http.js'

/**
 * A small in-memory rate limit, by named budget.
 *
 * Before Phase 9 only the crew's code pages had one, and it was private to that
 * file. So login could be tried without limit, anyone could file requests as
 * fast as a script could post them, and when a later route took over the crew's
 * completion in its multipart form it took over the request without the limit.
 * One shared implementation, applied wherever the public can write, closes all
 * three.
 *
 * Budgets are named rather than attached to a route: two routes that create a
 * limiter with the same `bucket` draw on one count. That is what lets two
 * files that serve the same audience share a single allowance.
 *
 * In memory, per process, keyed by client address. A real deployment puts this
 * at the edge; keeping a version here means no public write is ever completely
 * unguarded, including in development.
 */
interface Options {
  /** The budget's name. Limiters sharing a name share a count. */
  bucket: string
  windowMs: number
  /** Requests allowed per window; the next one is refused. */
  max: number
  /** Said to the person refused, so it has to be words they can act on. */
  message: string
  /**
   * Tests file hundreds of requests from one address in a few seconds, so the
   * limit steps aside under NODE_ENV=test unless a test is about the limit.
   */
  enforceInTest?: boolean
}

interface Entry {
  count: number
  resetAt: number
}

const buckets = new Map<string, Map<string, Entry>>()

/** Past this many addresses a budget sweeps out the expired ones before growing. */
const SWEEP_AT = 10_000

export function rateLimit(options: Options) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (env.NODE_ENV === 'test' && !options.enforceInTest) return next()

    const now = Date.now()
    let bucket = buckets.get(options.bucket)
    if (!bucket) {
      bucket = new Map()
      buckets.set(options.bucket, bucket)
    }
    if (bucket.size > SWEEP_AT) {
      for (const [key, entry] of bucket) if (entry.resetAt <= now) bucket.delete(key)
    }

    const key = req.ip ?? 'unknown'
    const entry = bucket.get(key)
    if (!entry || entry.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + options.windowMs })
      return next()
    }

    entry.count++
    if (entry.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return next(new AppError(429, options.message))
    }
    next()
  }
}

/** Forget every count. For tests that exercise the limit itself. */
export function resetRateLimits(): void {
  buckets.clear()
}
