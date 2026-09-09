/**
 * Write the event log to disk for the research harness.
 *
 *   npm run export:eventlog
 *
 * The same projection the admin console downloads, straight from the service
 * rather than over HTTP, so the training data and the exported file are the
 * same rows by construction. `research/` reads this; nothing else does.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { buildEventLog, toCsv } from '../src/services/eventLog.js'

async function main() {
  const prisma = new PrismaClient()
  const rows = await buildEventLog()

  const out = path.resolve(process.cwd(), '../research/data/event-log.csv')
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, toCsv(rows), 'utf8')

  const cases = new Set(rows.map((r) => r.caseId)).size
  console.log(`wrote ${rows.length} events over ${cases} cases to research/data/event-log.csv`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
