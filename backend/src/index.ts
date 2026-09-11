import { createApp } from './app.js'
import { env } from './config/env.js'
import { referenceDate } from './config/systemClock.js'
import { createLogger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { warmBoards } from './routes/boards.js'
import { startEscalationSweep } from './services/escalation.js'

const log = createLogger('server')

const app = createApp()
let stopSweep: (() => void) | null = null

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
    // The board rollup is an aggregate over the whole corpus; computing it now
    // means the first person to open the boards register does not pay for it.
    warmBoards()
    // Layer 2's escalation sweep. Live requests only (I6).
    stopSweep = startEscalationSweep(prisma, env.ESCALATION_SWEEP_MS, (message) =>
      log.info(message),
    )
  }

  /*
   * One scheduler, and it is Layer 2's.
   *
   * Layer 0 has none: escalation is our concept and NYC records nothing like it.
   * The sweep started above acts only on live requests — never on the 350,000
   * untouched imported ones, every open one of which is past its deadline at the
   * snapshot and would escalate the moment the sweep first ran, over delays New
   * York lived through years ago.
   */
})

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`)
  stopSweep?.()
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
