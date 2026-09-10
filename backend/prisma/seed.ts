/**
 * Reference data for the NYC 311 replica: the three agencies, Brooklyn's
 * community boards, the six complaint types with their derived service levels,
 * and the handful of accounts needed to sign in.
 *
 * Nothing here invents a fact about New York. The agencies and their long names
 * are NYC's own `agency` / `agency_name` strings, the boards are the eighteen
 * that appear in the corpus, and every SLA is read out of
 * `research/data/nyc/sla-table.csv` rather than typed in — the previous system
 * carried seventeen assumed constants with no provenance, and that is the single
 * thing about it a reviewer could dismiss outright.
 *
 * The one place this file does invent is the user accounts, and they are all
 * flagged `isSynthetic` because of it. NYC publishes no case-worker identity
 * (F-12), so an agent account here stands in for a role the source data does not
 * record, and no screen may present one as a real person.
 *
 * Idempotent: every write upserts on a natural key, so re-running it after an
 * import changes nothing and destroys nothing. It does not append to the audit
 * chain, deliberately — the chain is a record of actions taken by actors, and
 * re-declaring the same reference data is neither.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import { PrismaClient, Role, SlaSource } from '@prisma/client'
import { hashPassword } from '../src/lib/auth.js'

const prisma = new PrismaClient()

const DATA_DIR = new URL('../../research/data/nyc/', import.meta.url)

/**
 * The password every seeded account shares. Dev fixture, printed at the end of
 * the run so nobody has to read the source to sign in; the accounts it opens
 * exist only in a synthetic replica.
 */
const SEED_PASSWORD = 'drishti-demo-2026'

/**
 * RFC 2606 reserves `.invalid`, so mail to these addresses cannot leave and
 * cannot collide with a real person's. The domain is the first thing a reviewer
 * sees next to a name, and it should say "not a real inbox" before the
 * `isSynthetic` badge has to.
 */
const SYNTHETIC_DOMAIN = 'synthetic.drishti.invalid'

/**
 * The three agencies that appear in the corpus, with the acronym and long name
 * NYC publishes.
 *
 * Three, not the four an earlier plan listed. The fourth would have been DPR,
 * carrying the public-toilet category the NOIDA model had; New York has no
 * analogue for it, and seeding an agency with no complaint type behind it would
 * be inventing an organisation to fill a table (F-16).
 */
const AGENCIES = [
  { code: 'DOT', name: 'Department of Transportation' },
  { code: 'DSNY', name: 'Department of Sanitation' },
  { code: 'DEP', name: 'Department of Environmental Protection' },
] as const

const BOARD_COUNT = 18

interface SlaRow {
  complaint_type: string
  agency: string
  requests: string
  closed_requests: string
  sla_hours: string
}

interface SlaMeta {
  quantile: number
  derived_at: string
}

/** `Street Light Condition` -> `street-light-condition`. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The sentence that has to travel with any breach figure computed from this
 * SLA.
 *
 * Written out in full and stored on the row rather than templated at render
 * time, because a caption is exactly the kind of thing that gets shortened
 * until the word "derived" falls off it.
 */
function slaNote(row: SlaRow, meta: SlaMeta): string {
  const percentile = `${Math.round(meta.quantile * 100)}th`
  const closed = Number(row.closed_requests).toLocaleString('en-US')
  const total = Number(row.requests).toLocaleString('en-US')
  return (
    `Derived: ${percentile} percentile of observed closure time for this complaint type ` +
    `(NYC 311 Brooklyn, 2022–2025; ${closed} closed of ${total} requests). ` +
    'NYC publishes no due date for this complaint type, so this target is measured from ' +
    'what the agency actually did, not promised.'
  )
}

function readSlaTable(): { rows: SlaRow[]; meta: SlaMeta } {
  const csvPath = fileURLToPath(new URL('sla-table.csv', DATA_DIR))
  const metaPath = fileURLToPath(new URL('sla-table.meta.json', DATA_DIR))

  const rows = parse(readFileSync(csvPath), { columns: true, bom: true }) as SlaRow[]
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as SlaMeta

  if (rows.length === 0) throw new Error(`No SLA rows in ${csvPath}`)
  return { rows, meta }
}

async function seedAgencies() {
  const byCode = new Map<string, number>()
  for (const agency of AGENCIES) {
    const row = await prisma.agency.upsert({
      where: { code: agency.code },
      create: { code: agency.code, name: agency.name },
      update: { name: agency.name },
    })
    byCode.set(row.code, row.id)
  }
  return byCode
}

/**
 * Borough at depth 0, community board at depth 1, and no deeper.
 *
 * That is a property of New York rather than a simplification: council
 * districts and police precincts cross board boundaries, so they cannot be
 * nodes in a tree that already contains boards (F-13). They ride on the request
 * as flat attributes instead, where they are free to overlap.
 *
 * `path` needs the row's own id, so each unit is written once and then given
 * its path — the same two-step the tree builder has always used.
 */
async function seedOrgTree() {
  const root = await prisma.orgUnit.upsert({
    where: { code: 'BK' },
    create: { code: 'BK', name: 'Brooklyn', kindLabel: 'Borough', depth: 0, path: 'pending', isLeaf: false },
    update: { name: 'Brooklyn', kindLabel: 'Borough', depth: 0, isLeaf: false },
  })
  const rootPath = `/${root.id}/`
  if (root.path !== rootPath) {
    await prisma.orgUnit.update({ where: { id: root.id }, data: { path: rootPath } })
  }

  const boards = new Map<number, number>()
  for (let n = 1; n <= BOARD_COUNT; n++) {
    const code = `BK-${String(n).padStart(2, '0')}`
    const name = `Community Board ${n}`
    const board = await prisma.orgUnit.upsert({
      where: { code },
      create: { code, name, kindLabel: 'Community Board', depth: 1, path: 'pending', parentId: root.id, isLeaf: true },
      update: { name, kindLabel: 'Community Board', depth: 1, parentId: root.id, isLeaf: true },
    })
    const path = `${rootPath}${board.id}/`
    if (board.path !== path) {
      await prisma.orgUnit.update({ where: { id: board.id }, data: { path } })
    }
    boards.set(n, board.id)
  }

  // Centroids are left null here. They are a measurement of where the work
  // actually is, and the importer computes them from the requests it loads.
  return { rootId: root.id, boards }
}

async function seedTaxonomy(agencies: Map<string, number>) {
  const { rows, meta } = readSlaTable()

  for (const row of rows) {
    const agencyId = agencies.get(row.agency)
    if (agencyId === undefined) {
      throw new Error(
        `The SLA table routes "${row.complaint_type}" to agency ${row.agency}, which this seed does not create. ` +
          `Known agencies: ${[...agencies.keys()].join(', ')}.`,
      )
    }

    const slaHours = Number(row.sla_hours)
    if (!Number.isFinite(slaHours) || slaHours <= 0) {
      throw new Error(`Unusable sla_hours for "${row.complaint_type}": ${JSON.stringify(row.sla_hours)}`)
    }

    const data = {
      code: slug(row.complaint_type),
      agencyId,
      slaHours,
      // Every type in this system is DERIVED_P75, and the enum exists so that
      // stays impossible to forget. Zero of 355,430 rows carry a due date.
      slaSource: SlaSource.DERIVED_P75,
      slaNote: slaNote(row, meta),
    }

    await prisma.requestType.upsert({
      where: { name: row.complaint_type },
      create: { name: row.complaint_type, ...data },
      update: data,
    })
  }

  return rows.length
}

/**
 * One citizen and one agent per agency.
 *
 * The password hash is written on create and never on update: bcrypt salts
 * every hash differently, so re-hashing on each run would rewrite four rows on
 * a seed that is supposed to change nothing.
 */
async function seedUsers(agencies: Map<string, number>, homeBoardId: number) {
  const passwordHash = await hashPassword(SEED_PASSWORD)
  const accounts: Array<{ email: string; name: string; role: Role; agencyId: number | null; orgUnitId: number | null }> =
    [
      {
        email: `resident@${SYNTHETIC_DOMAIN}`,
        name: 'Sample Resident',
        role: Role.CITIZEN,
        agencyId: null,
        orgUnitId: homeBoardId,
      },
      ...AGENCIES.map((agency) => ({
        email: `${agency.code.toLowerCase()}.agent@${SYNTHETIC_DOMAIN}`,
        name: `${agency.code} Duty Agent`,
        role: Role.AGENT,
        agencyId: agencies.get(agency.code) ?? null,
        orgUnitId: null,
      })),
    ]

  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      create: { ...account, passwordHash, isSynthetic: true },
      update: {
        name: account.name,
        role: account.role,
        agencyId: account.agencyId,
        orgUnitId: account.orgUnitId,
        // Never clears: an account standing in for a role NYC does not record
        // stays marked as one for as long as it exists.
        isSynthetic: true,
      },
    })
  }

  return accounts.length
}

async function main() {
  const agencies = await seedAgencies()
  const tree = await seedOrgTree()
  const types = await seedTaxonomy(agencies)

  // Board 7 is Sunset Park; any board will do for pre-filling an intake form,
  // and a citizen's home board is not an authority scope.
  const homeBoard = tree.boards.get(7)
  if (homeBoard === undefined) throw new Error('Community Board 7 was not created')
  const users = await seedUsers(agencies, homeBoard)

  // The importer creates these from the corpus; the seed only reports them, so
  // that running the seed after an import reads as a no-op rather than a loss.
  const descriptors = await prisma.requestDescriptor.count()
  const requests = await prisma.serviceRequest.count()

  console.log('Seeded:')
  console.log(`  agencies          ${agencies.size}`)
  console.log(`  org units         ${tree.boards.size + 1}  (1 borough, ${tree.boards.size} community boards)`)
  console.log(`  request types     ${types}  (SLA read from research/data/nyc/sla-table.csv)`)
  console.log(`  users             ${users}  (all synthetic, @${SYNTHETIC_DOMAIN}, password: ${SEED_PASSWORD})`)
  console.log(`  descriptors       ${descriptors}  (created by the importer, left alone here)`)
  console.log(`  service requests  ${requests}  (created by the importer, left alone here)`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
