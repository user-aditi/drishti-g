import type { NextFunction, Request, Response } from 'express'
import { ZodError, type ZodTypeAny } from 'zod'
import { unprocessable } from '../utils/http.js'

type Source = 'body' | 'query' | 'params'

/**
 * Validate and *replace* the request segment with the parsed result, so handlers
 * receive coerced types (numbers as numbers) rather than raw strings.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source])
      if (source === 'query') {
        // req.query is a getter in Express 4; assign onto it rather than replace.
        Object.defineProperty(req, 'query', { value: parsed, writable: true })
      } else {
        req[source] = parsed
      }
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
        return next(unprocessable(details[0]?.message ?? 'Invalid request', details))
      }
      next(err)
    }
  }
}
