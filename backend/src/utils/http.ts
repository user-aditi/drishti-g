import type { NextFunction, Request, Response } from 'express'

/** An error carrying the HTTP status it should surface as. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, m, d)
export const unauthorized = (m = 'Not authenticated') => new AppError(401, m)
export const forbidden = (m = 'You do not have access to this') => new AppError(403, m)
export const notFound = (m = 'Not found') => new AppError(404, m)
export const conflict = (m: string) => new AppError(409, m)
export const unprocessable = (m: string, d?: unknown) => new AppError(422, m, d)
export const gone = (m: string) => new AppError(410, m)

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

/**
 * Express 4 does not catch rejected promises from async handlers, so an await
 * that throws would hang the request instead of returning 500. Wrapping every
 * async route keeps error handling in one place.
 */
export function asyncHandler(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}
