import path from 'node:path'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'
import { adminRouter } from './routes/admin.js'
import { authRouter } from './routes/auth.js'
import { complaintsRouter } from './routes/complaints.js'
import { notificationsRouter } from './routes/notifications.js'
import { orgRouter } from './routes/org.js'
import { riskRouter } from './routes/risk.js'
import { systemRouter } from './routes/system.js'
import { tasksRouter } from './routes/tasks.js'

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
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'))

  app.use(`/${env.UPLOAD_DIR}`, express.static(path.resolve(process.cwd(), env.UPLOAD_DIR)))

  const api = env.API_PREFIX
  app.use(api, systemRouter)
  app.use(`${api}/auth`, authRouter)
  app.use(api, orgRouter)
  app.use(`${api}/complaints`, complaintsRouter)
  app.use(`${api}/tasks`, tasksRouter)
  app.use(`${api}/risk`, riskRouter)
  app.use(`${api}/notifications`, notificationsRouter)
  app.use(`${api}/admin`, adminRouter)

  app.get('/', (_req, res) => {
    res.json({ name: 'DRISHTI-G API', version: '0.2.0', health: `${api}/health` })
  })

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
