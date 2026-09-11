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
import { officerRouter } from './routes/officer.js'
import { supervisorRouter } from './routes/supervisor.js'
import { workOrdersRouter } from './routes/workOrders.js'
import { assignOnFiling } from './services/assignment.js'
import { onFiled } from './services/requestHooks.js'

/**
 * Where the layers are composed — the one file allowed to know about all of
 * them.
 *
 * Layer 0 is the first block of routers: nothing NYC 311 does not itself do, and
 * no reference to anything this project adds, so it can serve as the control
 * every later layer is measured against. Layer 1 follows, in its own routers,
 * and attaches to the baseline in exactly one place — the filing hook below.
 * Delete the Layer 1 block and the baseline is back, unmodified.
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

  // ---- Layer 1: officer identity. Ours, not NYC's. -------------------------
  // Every new request leaves its filing transaction with an accountable
  // officer, when one is posted to its board or borough.
  onFiled('layer1:assign-on-filing', assignOnFiling)
  app.use(`${api}/officer`, officerRouter)
  app.use(`${api}/work-orders`, workOrdersRouter)
  app.use(api, supervisorRouter)

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
