import { createApp } from './app.js'
import { env } from './config/env.js'
import { createLogger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { specStatus } from './services/modelSpec.js'
import { startScheduler, stopScheduler } from './services/scheduler.js'

const log = createLogger('server')

const app = createApp()


const server = app.listen(env.PORT, () => {
  log.info(`listening on http://localhost:${env.PORT}${env.API_PREFIX}`)
  // Escalation, verification and clustering are driven by time passing rather
  // than by anyone clicking. Started after the port is bound so a boot failure
  // is never mistaken for a sweep failure.
  if (env.NODE_ENV !== 'test') startScheduler()

  /*
   * Say which models are loaded, at boot, once.
   *
   * Every model service falls back cleanly when its spec is missing — the
   * keyword matcher, the seeded deadline hours, no automation. That is the right
   * behaviour and it is also the danger: the system starts, answers every
   * request, and is quietly running its pre-Wave-3 self. Three warnings in a log
   * nobody greps is not visibility, so the state is printed where a person
   * starting the server will see it.
   */
  if (env.NODE_ENV !== 'test') {
    for (const line of specStatus([
      { name: 'classifier', file: 'classifier-spec.json', contract: 'clf/tfidf-l2/multinomial-nb/1' },
      { name: 'predictor ', file: 'predictor-spec.json', contract: 'pred/counting-backoff/1' },
      { name: 'sla       ', file: 'sla-spec.json', contract: 'sla/empirical-quantiles/1' },
      { name: 'gate      ', file: 'gate-spec.json', contract: 'gate/split-conformal/1' },
    ])) {
      log.info(`  ${line}`)
    }
  }
})

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`)
  stopScheduler()
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
