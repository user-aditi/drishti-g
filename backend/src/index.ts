import { createApp } from './app.js'
import { env } from './config/env.js'
import { createLogger } from './lib/logger.js'
import { closeDriver, initConstraints } from './lib/neo4j.js'
import { prisma } from './lib/prisma.js'

const log = createLogger('server')

const app = createApp()

// Neo4j being unreachable must not stop the API from booting: Postgres serves
// every endpoint that does not touch the graph, and /health reports it as down.
initConstraints().catch((err) => log.warn('Neo4j constraints could not be applied', err))

const server = app.listen(env.PORT, () => {
  log.info(`listening on http://localhost:${env.PORT}${env.API_PREFIX}`)
})

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`)
  server.close()
  await Promise.allSettled([prisma.$disconnect(), closeDriver()])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
