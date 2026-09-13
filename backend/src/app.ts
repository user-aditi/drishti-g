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
import { notificationsRouter } from './routes/notifications.js'
import { tellReporter } from './services/status.js'
import { officerRouter } from './routes/officer.js'
import { supervisorRouter } from './routes/supervisor.js'
import { workOrdersRouter } from './routes/workOrders.js'
import { escalationsRouter } from './routes/escalations.js'
import { proofRouter } from './routes/proof.js'
import { adminRouter } from './routes/admin.js'
import { riskRouter } from './routes/risk.js'
import { GCCE_CONTRACT, routingRouter } from './routes/routing.js'
import { adminPeopleRouter } from './routes/adminPeople.js'
import { adminSystemRouter } from './routes/adminSystem.js'
import { GRIE_CONTRACT, GRIE_SPEC_FILE } from './services/grie.js'
import { declareSpec } from './services/modelSpec.js'
import { describeProofProgress, PROOF_CONTRACT } from './services/proof.js'
import { assignOnFiling } from './services/assignment.js'
import { describeOfficerProgress, withdrawWorkOnClose } from './services/workOrder.js'
import { describeEscalationProgress, resolveEscalationsOnClose } from './services/escalation.js'
import { onDescribeProgress, onFiled, onStatusChanged } from './services/requestHooks.js'

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
  app.use(`${api}/notifications`, notificationsRouter)
  // The resident who reported a request hears when its status changes.
  onStatusChanged('layer0:tell-the-reporter', tellReporter)

  // ---- Layer 4: photo verification. Ours, not NYC's. -----------------------
  // Mounted before Layer 1's work-order router and on the same path, because it
  // takes one request Layer 1 also takes: the crew's completion, in the
  // multipart form that carries photographs. Anything else falls straight
  // through. Remove this line and Layer 1 behaves exactly as it did before
  // Layer 4 existed — which is the property N5 is about.
  declareSpec({ name: 'Photo verification (recycled-photograph threshold)', file: 'proof-spec.json', contract: PROOF_CONTRACT })
  onDescribeProgress('layer4:proof', describeProofProgress)
  app.use(api, proofRouter)

  // ---- Layer 1: officer identity. Ours, not NYC's. -------------------------
  // Every new request leaves its filing transaction with an accountable
  // officer, when one is posted to its board or borough.
  onFiled('layer1:assign-on-filing', assignOnFiling)
  // And a request that is closed takes its unfinished jobs off the street.
  onStatusChanged('layer1:withdraw-work-on-close', withdrawWorkOnClose)
  onDescribeProgress('layer1:officer-and-crews', describeOfficerProgress)
  app.use(`${api}/officer`, officerRouter)
  app.use(`${api}/work-orders`, workOrdersRouter)
  app.use(api, supervisorRouter)

  // ---- Layer 2: escalation. Ours, not NYC's. --------------------------------
  // The sweep that climbs the ladder is started in index.ts: a timer belongs to
  // the running process, not to an app that every test file composes afresh.
  // A request that closes resolves its escalations, so the register can say how
  // long the senior person had it.
  onStatusChanged('layer2:resolve-escalations-on-close', resolveEscalationsOnClose)
  onDescribeProgress('layer2:escalations', describeEscalationProgress)
  app.use(api, escalationsRouter)

  // ---- Layer 3: GRIE, and GCCE's routing report. Ours, not NYC's. ---------
  // All three are the administrator's. The audit viewer has its own routes
  // rather than widening Layer 0's to a Layer 3 role (N5).
  app.use(`${api}/risk`, riskRouter)
  app.use(`${api}/routing`, routingRouter)
  app.use(`${api}/admin`, adminRouter)
  // The administrator's people and system pages, which report on every layer
  // above and so are composed here, with each layer declaring its own model.
  declareSpec({ name: 'GRIE (risk)', file: GRIE_SPEC_FILE, contract: GRIE_CONTRACT })
  declareSpec({ name: 'GCCE (routing report)', file: 'gcce-spec.json', contract: GCCE_CONTRACT })
  app.use(`${api}/admin`, adminPeopleRouter)
  app.use(`${api}/admin`, adminSystemRouter)

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
