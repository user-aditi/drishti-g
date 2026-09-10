import { createApp } from './app.js'
import { env } from './config/env.js'
import { referenceDate } from './config/systemClock.js'
import { createLogger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'

const log = createLogger('server')

const app = createApp()

const server = app.listen(env.PORT, () => {
  log.info(`listening on http://localhost:${env.PORT}${env.API_PREFIX}`)

  /*
   * Say which day the system thinks it is, at boot, once.
   *
   * Almost every date this system shows is read against a configured reference
   * date rather than the wall clock, because the corpus is real historical data
   * ending in December 2025. Get that wrong and nothing throws: the register
   * simply reports every one of 350,000 requests as overdue, or none of them,
   * and both look plausible until someone counts. The same class of mistake
   * once produced 2,554 open complaints and zero overdue.
   *
   * So it is printed where a person starting the server will see it, rather
   * than left in a config file nobody opens.
   */
  if (env.NODE_ENV !== 'test') {
    log.info(`  system reference date: ${referenceDate().toISOString()}`)
  }

  /*
   * No scheduler.
   *
   * The previous system started escalation, verification and clustering sweeps
   * here. None of them belong in Layer 0 — escalation is our concept and NYC
   * records nothing like it — and a sweep let loose over 350,000 imported rows
   * would enqueue work for requests New York closed years ago.
   */
})

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`)
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
