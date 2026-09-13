/**
 * Layer 2's measurement — the gate, and the question the plan asked.
 *
 *   npm run layer2:measure
 *
 * The plan asked: how many requests would have escalated, and do they coincide
 * with the ones NYC actually closed late? The second half answers itself. The
 * automatic trigger fires when a request passes its derived deadline, and "closed
 * late" means closed after that same deadline, so the two sets are identical by
 * construction — 100% coincidence, and no evidence of anything. It is printed as
 * the tautology it is, not as a result.
 *
 * The question that does have an answer, on NYC's real timestamps, is whether
 * escalating *earlier* would be worth it. At a fraction f of the service level,
 * an early warning flags every request still open. Every request that ends up
 * late was open at f, so such a warning catches all of them — recall is 1 by
 * construction as well — and the one informative number is its precision: of the
 * requests it flags, how many really do end up late. That, the lead time it buys,
 * and the load it puts on a supervisor are what this reports.
 *
 * Every figure below is computed from NYC's own timestamps. None is simulated.
 *
 * Then the gate, on live data: the automatic trigger has fired only on breach,
 * never on an untouched imported row, and has left no breached live request
 * behind; Layer 0 and Layer 1 source reference no Layer 2 concept; and the chain
 * verifies.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { verifyChain } from '../src/services/audit.js'

const prisma = new PrismaClient()
const FRACTIONS = [0.25, 0.5, 0.75]
const SWEEP_MS = Number(process.env.ESCALATION_SWEEP_MS ?? 300_000)

const LOWER_LAYER_FILES = [
  // Layer 0
  'src/routes/auth.ts',
  'src/routes/system.ts',
  'src/routes/requests.ts',
  'src/routes/taxonomy.ts',
  'src/routes/boards.ts',
  'src/routes/map.ts',
  'src/routes/audit.ts',
  'src/services/audit.ts',
  'src/services/routing.ts',
  'src/services/requestHooks.ts',
  'src/utils/serialize.ts',
  'src/config/systemClock.ts',
  'src/services/status.ts',
  'src/middleware/rateLimit.ts',
  // Layer 1
  'src/routes/officer.ts',
  'src/routes/supervisor.ts',
  'src/routes/workOrders.ts',
  'src/services/assignment.ts',
  'src/services/workOrder.ts',
  'src/services/qr.ts',
  'src/utils/serializeLayer1.ts',
]
const LAYER2_TERMS = /\b(escalat\w*|Escalat\w*|COMMISSIONER|commissioner)/

interface Result {
  name: string
  ok: boolean
  detail: string
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const n = (v: bigint | number | null) => Number(v ?? 0)

/** What the ladder would have done to NYC's own history, rung by rung. */
async function counterfactual() {
  const [row] = await prisma.$queryRaw<
    { requests: bigint; rung1: bigint; rung2: bigint; coincide: bigint; late: bigint }[]
  >`
    WITH base AS (
      SELECT r."createdAt" AS c, r."slaDueAt" AS d, r."closedAt" AS x
      FROM service_requests r
      WHERE r."isImported" AND r."slaDueAt" IS NOT NULL
        AND (r."closedAt" IS NULL OR r."closedAt" >= r."createdAt")
    )
    SELECT
      COUNT(*)                                                     AS requests,
      COUNT(*) FILTER (WHERE x IS NULL OR x > d)                    AS rung1,
      COUNT(*) FILTER (WHERE x IS NULL OR x > d + (d - c))          AS rung2,
      COUNT(*) FILTER (WHERE (x IS NULL OR x > d) AND (x IS NULL OR x > d)) AS coincide,
      COUNT(*) FILTER (WHERE x IS NULL OR x > d)                    AS late
    FROM base
  `
  return {
    requests: n(row!.requests),
    rung1: n(row!.rung1),
    rung2: n(row!.rung2),
    coincide: n(row!.coincide),
    late: n(row!.late),
  }
}

/** Precision of an early warning at a fraction of the service level. */
async function earlyWarning(fraction: number) {
  const [row] = await prisma.$queryRaw<{ flagged: bigint; late: bigint; lead: number | null }[]>`
    WITH base AS (
      SELECT r."createdAt" AS c, r."slaDueAt" AS d, r."closedAt" AS x
      FROM service_requests r
      WHERE r."isImported" AND r."slaDueAt" IS NOT NULL
        AND (r."closedAt" IS NULL OR r."closedAt" >= r."createdAt")
    )
    SELECT
      COUNT(*) FILTER (WHERE x IS NULL OR x > c + (d - c) * ${fraction}::float8) AS flagged,
      COUNT(*) FILTER (WHERE x IS NULL OR x > d)                                 AS late,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (d - c)) * (1 - ${fraction}::float8) / 3600.0
      )                                                                          AS lead
    FROM base
  `
  const flagged = n(row!.flagged)
  const late = n(row!.late)
  return { fraction, flagged, late, precision: flagged === 0 ? 0 : late / flagged, leadHours: Number(row!.lead ?? 0) }
}

/** Per complaint type, at half the service level. */
async function earlyWarningByType() {
  return prisma.$queryRaw<{ type: string; flagged: bigint; late: bigint }[]>`
    SELECT t.name AS type,
      COUNT(*) FILTER (WHERE r."closedAt" IS NULL OR r."closedAt" > r."createdAt" + (r."slaDueAt" - r."createdAt") * 0.5) AS flagged,
      COUNT(*) FILTER (WHERE r."closedAt" IS NULL OR r."closedAt" > r."slaDueAt") AS late
    FROM service_requests r JOIN request_types t ON t.id = r."typeId"
    WHERE r."isImported" AND r."slaDueAt" IS NOT NULL
      AND (r."closedAt" IS NULL OR r."closedAt" >= r."createdAt")
    GROUP BY t.name ORDER BY t.name
  `
}

/** Rung-1 escalations a supervisor would receive, per agency per month. */
async function workload() {
  return prisma.$queryRaw<{ agency: string; median: number; p90: number; months: bigint }[]>`
    WITH monthly AS (
      SELECT a.code AS agency, date_trunc('month', r."slaDueAt") AS month, COUNT(*) AS escalations
      FROM service_requests r JOIN agencies a ON a.id = r."agencyId"
      WHERE r."isImported" AND r."slaDueAt" IS NOT NULL
        AND (r."closedAt" IS NULL OR r."closedAt" >= r."createdAt")
        AND (r."closedAt" IS NULL OR r."closedAt" > r."slaDueAt")
        AND r."slaDueAt" < TIMESTAMP '2026-01-01'
      GROUP BY 1, 2
    )
    SELECT agency,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY escalations) AS median,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY escalations) AS p90,
      COUNT(*) AS months
    FROM monthly GROUP BY agency ORDER BY agency
  `
}

async function gate(): Promise<Result[]> {
  const [row] = await prisma.$queryRaw<
    { early1: bigint; early2: bigint; untouched: bigint; leftBehind: bigint; total: bigint }[]
  >`
    SELECT
      (SELECT COUNT(*) FROM escalations e JOIN service_requests r ON r.id = e."requestId"
        WHERE e.trigger = 'SLA_BREACH' AND e."toLevel" = 1 AND e.at <= r."slaDueAt")     AS early1,
      (SELECT COUNT(*) FROM escalations e JOIN service_requests r ON r.id = e."requestId"
        WHERE e.trigger = 'SLA_BREACH' AND e."toLevel" = 2
          AND e.at <= r."slaDueAt" + (r."slaDueAt" - r."createdAt"))                     AS early2,
      (SELECT COUNT(*) FROM escalations e JOIN service_requests r ON r.id = e."requestId"
        WHERE r."isImported" AND NOT EXISTS (
          SELECT 1 FROM request_status_history h
          WHERE h."requestId" = r.id AND h."actorId" IS NOT NULL))                      AS untouched,
      (SELECT COUNT(*) FROM service_requests r
        WHERE r.status <> 'CLOSED' AND r."escalationLevel" = 0
          AND r."slaDueAt" < now() - (${2 * SWEEP_MS} * INTERVAL '1 millisecond')
          AND (NOT r."isImported" OR EXISTS (
            SELECT 1 FROM request_status_history h
            WHERE h."requestId" = r.id AND h."actorId" IS NOT NULL)))                   AS "leftBehind",
      (SELECT COUNT(*) FROM escalations)                                                AS total
  `
  const early = n(row!.early1) + n(row!.early2)
  return [
    {
      name: 'on breach only',
      ok: early === 0,
      detail: `${n(row!.total)} escalations recorded; ${early} automatic ones fired at or before their threshold`,
    },
    {
      name: 'history left alone',
      ok: n(row!.untouched) === 0,
      detail: `${n(row!.untouched)} escalations on imported requests this system never acted on (I6)`,
    },
    {
      name: 'none left behind',
      ok: n(row!.leftBehind) === 0,
      detail: `${n(row!.leftBehind)} live requests breached more than two sweeps ago and still at rung 0`,
    },
  ]
}

function baseline(): Result {
  const hits: string[] = []
  for (const file of LOWER_LAYER_FILES) {
    const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    code.split('\n').forEach((line, i) => {
      const match = LAYER2_TERMS.exec(line)
      if (match) hits.push(`${file}:${i + 1} "${match[0]}"`)
    })
  }
  return {
    name: 'layering',
    ok: hits.length === 0,
    detail:
      hits.length === 0
        ? `${LOWER_LAYER_FILES.length} Layer 0 and Layer 1 source files reference no Layer 2 concept`
        : `a lower layer reaches into Layer 2: ${hits.join('; ')}`,
  }
}

async function main() {
  console.log('Measuring Layer 2 — escalation\n')

  const cf = await counterfactual()
  console.log('What the ladder would have done to NYC’s own history (imported rows, valid durations)')
  console.log(`  ${cf.requests.toLocaleString('en-US')} requests`)
  console.log(`  rung 1 (past the derived deadline):        ${cf.rung1.toLocaleString('en-US')} (${pct(cf.rung1 / cf.requests)})`)
  console.log(`  rung 2 (open past twice the service level): ${cf.rung2.toLocaleString('en-US')} (${pct(cf.rung2 / cf.requests)})`)
  console.log(
    `  coincidence with NYC's late closures:      ${pct(cf.coincide / Math.max(cf.late, 1))} — by construction. The trigger and`,
  )
  console.log('  "late" are defined by the same derived deadline, so this measures nothing.')
  console.log('  The rung-1 share is near 25% by construction too: the derived deadline is each')
  console.log('  type’s 75th-percentile close time, so about a quarter of requests pass it.')

  console.log('\nThe question with an answer: would an earlier warning be right?')
  console.log('  fraction of SLA   flagged     end up late   precision   median lead time')
  for (const f of FRACTIONS) {
    const w = await earlyWarning(f)
    console.log(
      `  ${String(f).padEnd(16)}  ${w.flagged.toLocaleString('en-US').padStart(8)}   ${w.late.toLocaleString('en-US').padStart(10)}   ${pct(w.precision).padStart(9)}   ${w.leadHours.toFixed(1)} h`,
    )
  }
  console.log('  Recall is 100% at every fraction by construction: a request late at its deadline')
  console.log('  was necessarily still open earlier. Precision is the only informative number.')
  console.log('  Lead time is (1 − f) of the service level, also by construction; it is shown')
  console.log('  because it is what a supervisor would be given, not because it was discovered.')

  console.log('\n  at half the service level, by complaint type')
  for (const row of await earlyWarningByType()) {
    const flagged = n(row.flagged)
    console.log(`    ${row.type.padEnd(24)} ${pct(flagged === 0 ? 0 : n(row.late) / flagged).padStart(7)} of ${flagged.toLocaleString('en-US')} flags end up late`)
  }

  console.log('\nLoad on a supervisor: rung-1 escalations per agency per month, 2022–2025')
  for (const row of await workload()) {
    console.log(`  ${row.agency.padEnd(5)} median ${Number(row.median).toFixed(0).padStart(5)}   p90 ${Number(row.p90).toFixed(0).padStart(5)}   over ${n(row.months)} months`)
  }

  console.log('\nThe gate, on live data')
  const results = [...(await gate()), baseline()]
  const chain = await verifyChain(prisma)
  results.push({
    name: 'chain',
    ok: chain.valid,
    detail: chain.valid ? `${chain.checked} entries verify` : `broken at ${chain.brokenAtId}: ${chain.reason}`,
  })
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(19)} ${r.detail}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? '\nAll checks pass.' : `\n${failed} check(s) failed.`)
  process.exitCode = failed === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
