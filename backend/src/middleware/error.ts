import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { env } from '../config/env.js'
import { createLogger } from '../lib/logger.js'
import { AppError } from '../utils/http.js'

const log = createLogger('http')

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, `No route matches ${req.method} ${req.path}`))
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, details: err.details })
    return
  }

  // Translate the Prisma errors that map cleanly onto HTTP, so a duplicate email
  // reads as 409 rather than an opaque 500.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'value'
      res.status(409).json({ error: `That ${target} is already in use` })
      return
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'The requested record does not exist' })
      return
    }
    if (err.code === 'P2003') {
      res.status(422).json({ error: 'That reference points at something which does not exist' })
      return
    }
  }

  log.error('unhandled error', err)
  res.status(500).json({
    error: 'Something went wrong on our end',
    ...(env.isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  })
}
