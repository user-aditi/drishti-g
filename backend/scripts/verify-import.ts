/**
 * Gate 1 and Gate 2's data checks, as one re-runnable command.
 *
 *   npm run verify:import
 *
 * These exist because "the import finished" and "the import is correct" are
 * different claims, and only one of them is easy. A mapping that silently
 * defaults an unrecognised status, a timestamp parsed in the wrong zone, a batch
 * committed twice — none of those change the row count, and all of them would
 * propagate into a paper.
 *
 * Five checks, in the order they would fail:
 *
 *   1. The audit chain verifies end to end.
 *   2. No fabricated history — one status row per imported request, no actor,
 *      no invented transitions. This is the one that matters most; see I5.
 *   3. Overdue is a plausible share rather than everything or nothing, which is
 *      what a wall-clock comparison would produce on a 2025 corpus (I4).
 *   4. Ten random requests match the live source API field for field.
 *   5. Our resolution-time distribution matches the one computed independently
 *      in Python from the downloaded CSV, per type, within 5%.
 *
 * Check 4 goes to the network. NYC 311 is updated daily, so a request that has
 * been reopened since the corpus was pulled will differ legitimately; the check
 * reports which fields disagree rather than just failing, so that case is
 * distinguishable from a mapping bug.
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { verifyChain } from '../src/services/audit.js'
import { referenceDate } from '../src/config/systemClock.js'

const prisma = new PrismaClient()
const RESOURCE = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json'
const SLA_TABLE = new URL('../../research/data/nyc/sla-table.csv', import.meta.url)

/** NYC's status strings to ours. Identity, deliberately — see the schema. */
const STATUS: Record<string, string> = {
  Closed: 'CLOSED',
  Open: 'OPEN',
  Assigned: 'ASSIGNED',
  Started: 'STARTED',
  'In Progress': 'IN_PROGRESS',
  Pending: 'PENDING',
  Unspecified: 'UNSPECIFIED',
}

const SPOT_CHECK_SAMPLE = 10
const FIDELITY_TOLERANCE = 0.05

let failures = 0
function report(name: string, ok: boolean, detail: string) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`)
}

// 1 — the chain -------------------------------------------------------------
const chain = await verifyChain(prisma)
report(
  'audit chain verifies',
  chain.valid,
  chain.valid
    ? `${chain.checked} entries, head ${chain.head?.slice(0, 12)}`
    : `broken at ${chain.brokenAtId}: ${chain.reason}`,
)

// 2 — no fabricated history -------------------------------------------------
const imported = await prisma.serviceRequest.count({ where: { isImported: true } })
const [historyRows, withActor, withFrom, actionRows] = await Promise.all([
  prisma.requestStatusHistory.count({ where: { request: { isImported: true } } }),
  prisma.requestStatusHistory.count({
    where: { request: { isImported: true }, actorId: { not: null } },
  }),
  prisma.requestStatusHistory.count({
    where: { request: { isImported: true }, fromStatus: { not: null } },
  }),
  prisma.auditEvent.count({ where: { source: { not: 'import' }, action: { contains: 'import' } } }),
])
report(
  'one history row per import',
  historyRows === imported,
  `${historyRows.toLocaleString()} rows for ${imported.toLocaleString()} requests`,
)
report(
  'no invented actors or transitions',
  withActor === 0 && withFrom === 0 && actionRows === 0,
  `${withActor} actors, ${withFrom} from-statuses on imported history`,
)

// 3 — overdue is plausible ---------------------------------------------------
const now = referenceDate()
const open = await prisma.serviceRequest.count({ where: { closedAt: null } })
const overdue = await prisma.serviceRequest.count({
  where: { closedAt: null, slaDueAt: { lt: now } },
})
const share = open === 0 ? 0 : overdue / open
report(
  'overdue share is plausible',
  open > 0 && share > 0 && share < 1,
  `${overdue.toLocaleString()} of ${open.toLocaleString()} open (${(share * 100).toFixed(1)}%) at ${now.toISOString().slice(0, 10)}`,
)

// 4 — spot check against the source -----------------------------------------
const picks = Array.from({ length: SPOT_CHECK_SAMPLE }, () =>
  Math.floor(Math.random() * imported),
)
let matched = 0
const drifted: string[] = []
for (const skip of picks) {
  const ours = await prisma.serviceRequest.findFirstOrThrow({
    where: { isImported: true },
    skip,
    include: { type: true, descriptor: true, agency: true, orgUnit: true },
  })
  const key = ours.srNumber.replace(/^NYC-/, '')
  const [theirs] = (await (await fetch(`${RESOURCE}?unique_key=${key}`)).json()) as Record<
    string,
    string
  >[]
  if (!theirs) {
    drifted.push(`${ours.srNumber}: not found at source`)
    continue
  }

  const board =
    theirs.community_board && /^\d/.test(theirs.community_board)
      ? `BK-${theirs.community_board.split(' ')[0]!.padStart(2, '0')}`
      : null
  const fields: [string, unknown, unknown][] = [
    ['status', ours.status, STATUS[theirs.status!]],
    ['agency', ours.agency.code, theirs.agency],
    ['type', ours.type.name, theirs.complaint_type],
    ['descriptor', ours.descriptor?.name ?? null, theirs.descriptor ?? null],
    ['created', ours.createdAt.toISOString().slice(0, 19), theirs.created_date?.slice(0, 19)],
    [
      'closed',
      ours.closedAt?.toISOString().slice(0, 19) ?? null,
      theirs.closed_date?.slice(0, 19) ?? null,
    ],
    ['board', ours.orgUnit?.code ?? null, board],
    ['channel', ours.channel, theirs.open_data_channel_type ?? 'UNKNOWN'],
  ]

  const bad = fields.filter(([, a, b]) => a !== b)
  if (bad.length === 0) matched++
  else
    drifted.push(
      `${ours.srNumber}: ${bad.map(([f, a, b]) => `${f} ${JSON.stringify(a)}≠${JSON.stringify(b)}`).join(', ')}`,
    )
}
report('spot check against source', matched === SPOT_CHECK_SAMPLE, `${matched}/${SPOT_CHECK_SAMPLE} match exactly`)
for (const line of drifted) console.log(`        ${line}`)

// 5 — distribution fidelity --------------------------------------------------
const csv = readFileSync(SLA_TABLE, 'utf8').trim().split('\n')
const header = csv[0]!.split(',')
const col = (name: string) => header.indexOf(name)
const source = new Map<string, { p50: number; p75: number; closed: number }>()
for (const line of csv.slice(1)) {
  const c = line.split(',')
  source.set(c[col('complaint_type')]!, {
    p50: +c[col('p50_hours')]!,
    p75: +c[col('sla_hours')]!,
    closed: +c[col('closed_requests')]!,
  })
}

const dist = await prisma.$queryRaw<{ name: string; closed: bigint; p50: number; p75: number }[]>`
  SELECT t.name,
         COUNT(*) AS closed,
         PERCENTILE_CONT(0.50) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (r."closedAt" - r."createdAt")) / 3600.0) AS p50,
         PERCENTILE_CONT(0.75) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (r."closedAt" - r."createdAt")) / 3600.0) AS p75
  FROM service_requests r
  JOIN request_types t ON t.id = r."typeId"
  WHERE r."closedAt" IS NOT NULL AND r."closedAt" >= r."createdAt"
  GROUP BY t.name
  ORDER BY t.name
`

let worst = 0
for (const row of dist) {
  const s = source.get(row.name)
  if (!s) continue
  worst = Math.max(
    worst,
    Math.abs(Number(row.p50) - s.p50) / s.p50,
    Math.abs(Number(row.p75) - s.p75) / s.p75,
    Math.abs(Number(row.closed) - s.closed) / s.closed,
  )
}
report(
  'resolution-time fidelity',
  worst < FIDELITY_TOLERANCE,
  `worst drift ${(worst * 100).toFixed(3)}% across ${dist.length} types (tolerance ${FIDELITY_TOLERANCE * 100}%)`,
)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
