import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'
import { auditRouter } from './routes/audit.js'
import { authRouter } from './routes/auth.js'
import { boardsRouter } from './routes/boards.js'
import { mapRouter } from './routes/map.js'
import { requestsRouter } from './routes/requests.js'
import { systemRouter } from './routes/system.js'
import { taxonomyRouter } from './routes/taxonomy.js'

/**
 * Layer 0's entire surface.
 *
 * Eight routers, and nothing that NYC 311 does not itself do. There is no
 * officer desk, no escalation register and no risk endpoint, because a baseline
 * that has quietly borrowed one of our own concepts cannot serve as the control
 * every later layer is measured against.
 */
export function createApp(): Express {
  const app = express()

  app.use(helmet())
  app.use(cors({ origin: env.corsOrigins, credentials: true }))
  app.use(cookieParser())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'))

  const api = env.API_PREFIX
  app.use(api, systemRouter)
  app.use(`${api}/auth`, authRouter)
  app.use(`${api}/requests`, requestsRouter)
  app.use(`${api}/taxonomy`, taxonomyRouter)
  app.use(`${api}/boards`, boardsRouter)
  app.use(`${api}/map`, mapRouter)
  app.use(`${api}/audit`, auditRouter)

  app.get('/', (_req, res) => {
    res.json({
      name: 'DRISHTI-G API',
      // An academic replica built on NYC Open Data. Stated at the API root as
      // well as in the UI, because this is the other place someone meets the
      // system first, and it must never be mistakable for the real 311 service.
      description: 'Academic replica of NYC 311, built on NYC Open Data (erm2-nwe9)',
      affiliation: 'Not affiliated with, endorsed by, or a substitute for the City of New York',
      version: '0.4.0',
      health: `${api}/health`,
    })
  })

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
