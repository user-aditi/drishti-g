import path from 'node:path'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'
import { adminRouter } from './routes/admin.js'
import { authRouter } from './routes/auth.js'
import { citizenRouter } from './routes/citizen.js'
import { complaintsRouter } from './routes/complaints.js'
import { crewRouter } from './routes/crew.js'
import { consoleRouter } from './routes/console.js'
import { notificationsRouter } from './routes/notifications.js'
import { orgRouter } from './routes/org.js'
import { orgUnitsRouter } from './routes/orgUnits.js'
import { officerRouter } from './routes/officer.js'
import { riskRouter } from './routes/risk.js'
import { systemRouter } from './routes/system.js'
import { workRouter } from './routes/work.js'

export function createApp(): Express {
  const app = express()

  app.use(
    helmet({
      // Uploaded photos are served from this origin and rendered by the SPA on
      // another port; the default same-origin policy would block them.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  )
  app.use(cors({ origin: env.corsOrigins, credentials: true }))
  app.use(cookieParser())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'))

  app.use(`/${env.UPLOAD_DIR}`, express.static(path.resolve(process.cwd(), env.UPLOAD_DIR)))

  const api = env.API_PREFIX
  app.use(api, systemRouter)
  app.use(`${api}/auth`, authRouter)
  // The street worker's portal, addressed by code alone. Mounted above
  // orgRouter deliberately: that router sits at the API root and applies
  // `authenticate` to everything that enters it, so anything unauthenticated
  // has to be matched before the request ever reaches it.
  app.use(`${api}/work`, workRouter)
  app.use(api, orgRouter)
  app.use(`${api}/citizen`, citizenRouter)
  app.use(`${api}/complaints`, complaintsRouter)
  app.use(`${api}/officer`, officerRouter)
  app.use(`${api}/crew`, crewRouter)
  app.use(`${api}/risk`, riskRouter)
  app.use(`${api}/notifications`, notificationsRouter)
  app.use(`${api}/admin`, adminRouter)
  // Mounted ahead of consoleRouter so the tree endpoints keep their own file
  // while sharing the /console namespace the Super Admin panel already uses.
  app.use(`${api}/console`, orgUnitsRouter)
  app.use(`${api}/console`, consoleRouter)

  app.get('/', (_req, res) => {
    res.json({ name: 'DRISHTI-G API', version: '0.2.0', health: `${api}/health` })
  })

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
