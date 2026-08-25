import neo4j, { type Driver, type Session } from 'neo4j-driver'
import { env } from '../config/env.js'
import { createLogger } from './logger.js'

const log = createLogger('neo4j')

let driver: Driver | null = null

/**
 * Uniqueness constraints double as indexes, so the MERGE-heavy sync stays cheap.
 */
const CONSTRAINTS = [
  'CREATE CONSTRAINT dept_id IF NOT EXISTS FOR (d:Department) REQUIRE d.id IS UNIQUE',
  'CREATE CONSTRAINT sector_id IF NOT EXISTS FOR (s:Sector) REQUIRE s.id IS UNIQUE',
  'CREATE CONSTRAINT circle_id IF NOT EXISTS FOR (c:Circle) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT zone_id IF NOT EXISTS FOR (z:Zone) REQUIRE z.id IS UNIQUE',
  'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
  'CREATE CONSTRAINT category_id IF NOT EXISTS FOR (c:Category) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT complaint_id IF NOT EXISTS FOR (x:Complaint) REQUIRE x.id IS UNIQUE',
  'CREATE CONSTRAINT contractor_id IF NOT EXISTS FOR (c:Contractor) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE',
]

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD), {
      // The INFORMATION-level notifications (cartesian product hints) are noise
      // for a projection built entirely from MERGE-by-id.
      notificationFilter: { minimumSeverityLevel: 'WARNING' },
    })
  }
  return driver
}

export async function withGraph<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const session = getDriver().session()
  try {
    return await fn(session)
  } finally {
    await session.close()
  }
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close()
    driver = null
  }
}

export async function initConstraints(): Promise<void> {
  await withGraph(async (session) => {
    for (const stmt of CONSTRAINTS) await session.run(stmt)
  })
  log.info(`constraints ensured (${CONSTRAINTS.length})`)
}

export async function graphHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    await withGraph((session) => session.run('RETURN 1'))
    return { ok: true, detail: 'ok' }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
