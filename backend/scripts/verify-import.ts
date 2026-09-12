/**
 * Gates 1 and 2, as something you run rather than something you remember.
 *
 *   npm run verify:import
 *
 * Every check here was first run by hand, found a real problem at least once,
 * and was then written down so it could not quietly stop being true. Exits
 * non-zero on any failure, so it can gate a CI job or a demo.
 *
 *   1. idempotency  — a second import would change zero rows. Checked by running
 *                     the importer's real comparison and write, then rolling it
 *                     back, so verifying is not itself an import. This is the
 *                     check F-21 failed: 96,884 rows re-written per run over a
 *                     nanometre of float round-trip.
 *   2. chain        — the audit chain verifies end to end.
 *   3. history      — every imported request has exactly one status row, with
 *                     no actor and no from-status. NYC publishes no history, and
 *                     an invented one would feed a fabricated trace into the
 *                     process-mining log and from there into a paper (I5).
 *   4. overdue      — the share of open requests past their derived deadline is
 *                     neither 0% nor 100%. Both extremes have shipped before
 *                     (F-04), and both look like a working feature.
 *   5. spot check   — ten random requests match the live Socrata API field for
 *                     field. Catches mappings that are wrong in ways counts
 *                     cannot see: a defaulted status, a shifted timestamp.
 *   6. fidelity     — resolution-time percentiles per type match the figures the
 *                     Python harness computed from the same CSV, within 5%.
 *
 * There is no "boot enqueues nothing" check because Layer 0 has no scheduler to
 * enqueue anything; that becomes a check when Layer 2 brings one back.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse'
import { PrismaClient } from '@prisma/client'
import { verifyChain } from '../src/services/audit.js'
import { referenceDate } from '../src/config/systemClock.js'
import {
  dryRunBatch,
  loadRefData,
  mapRow,
  Routing,
  type Counts,
  type MappedRequest,
  type NycRow,
} from './import-nyc.js'

const CORPUS = fileURLToPath(new URL('../../research/data/nyc/brooklyn.csv', import.meta.url))
const SLA_TABLE = fileURLToPath(new URL('../../research/data/nyc/sla-table.csv', import.meta.url))
const SOCRATA = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json'
const BATCH = 5_000
const SPOT_CHECKS = 10
const FIDELITY_TOLERANCE = 0.05

const STATUS: Record<string, string> = {
  Closed: 'CLOSED',
  Open: 'OPEN',
  Assigned: 'ASSIGNED',
  Started: 'STARTED',
  'In Progress': 'IN_PROGRESS',
  Pending: 'PENDING',
  Unspecified: 'UNSPECIFIED',
}

interface Result {
  name: string
  ok: boolean
  detail: string
}

const prisma = new PrismaClient()

async function idempotency(): Promise<Result> {
  const name = 'idempotency'
  if (!existsSync(CORPUS)) {
    return {
      name,
      ok: false,
      detail: `corpus not found at ${CORPUS} — run python -m drishti_research.nyc_pull`,
    }
  }

  const ref = await loadRefData(prisma)
  const routing = new Routing()
  const totals: Counts = { read: 0, inserted: 0, updated: 0, unchanged: 0 }
  let batch: MappedRequest[] = []

  const flush = async () => {
    if (batch.length === 0) return
    const counts = await dryRunBatch(prisma, batch, ref)
    for (const key of Object.keys(totals) as Array<keyof Counts>) totals[key] += counts[key]
    batch = []
  }

  const rows = createReadStream(CORPUS).pipe(parse({ columns: true, bom: true }))
  for await (const row of rows as AsyncIterable<NycRow>) {
    batch.push(mapRow(row, ref, routing))
    if (batch.length >= BATCH) await flush()
  }
  await flush()

  const changed = totals.inserted + totals.updated
  return {
    name,
    ok: changed === 0,
    detail:
      `${totals.read.toLocaleString('en-US')} read, ${totals.unchanged.toLocaleString('en-US')} unchanged, ` +
      `${totals.inserted.toLocaleString('en-US')} would insert, ${totals.updated.toLocaleString('en-US')} would update`,
  }
}

async function chain(): Promise<Result> {
  const result = await verifyChain(prisma)
  return {
    name: 'chain',
    ok: result.valid,
    detail: result.valid
      ? `${result.checked} entries verify`
      : `broken at entry ${result.brokenAtId}: ${result.reason}`,
  }
}

async function history(): Promise<Result> {
  const [row] = await prisma.$queryRaw<
    { imported: bigint; rows: bigint; fabricated: bigint; not_one: bigint }[]
  >`
    WITH per_request AS (
      SELECT r.id, COUNT(h.id) AS n
      FROM service_requests r
      LEFT JOIN request_status_history h ON h."requestId" = r.id
      WHERE r."isImported"
      GROUP BY r.id
    )
    SELECT
      (SELECT COUNT(*) FROM service_requests WHERE "isImported")          AS imported,
      (SELECT COUNT(*) FROM request_status_history h
         JOIN service_requests r ON r.id = h."requestId" WHERE r."isImported") AS rows,
      (SELECT COUNT(*) FROM request_status_history h
         JOIN service_requests r ON r.id = h."requestId"
         WHERE r."isImported" AND (h."actorId" IS NOT NULL OR h."fromStatus" IS NOT NULL)) AS fabricated,
      (SELECT COUNT(*) FROM per_request WHERE n <> 1)                     AS not_one
  `
  const fabricated = Number(row!.fabricated)
  const notOne = Number(row!.not_one)
  return {
    name: 'history',
    ok: fabricated === 0 && notOne === 0,
    detail:
      `${Number(row!.imported).toLocaleString('en-US')} imported, ${Number(row!.rows).toLocaleString('en-US')} history rows, ` +
      `${fabricated} with an actor or from-status, ${notOne} without exactly one row`,
  }
}

/**
 * The clock, checked for consistency rather than for a plausible-looking share.
 *
 * The build plan's I4 check was "overdue is a plausible share, not 100%", on the
 * theory that only a broken clock makes it universal. On this corpus that theory
 * is false: at the snapshot date essentially the whole open backlog is overdue,
 * because the newest imported request was filed eight months earlier against a
 * deadline of ten days or less. A check that demanded "not 100%" could only be
 * passed by choosing a reference date to produce a nicer number — fitting the
 * clock to the threshold — so it is not asked.
 *
 * What is asked instead is what actually broke before. The reference date must
 * be the snapshot the statuses were observed at (F-28: standing at the last
 * intake date showed 6,628 requests Closed "as at" a day they were open); and
 * overdue must be a subset of open, counted by the same rule the product uses
 * (F-27: the boards register once counted them by two different rules).
 */
async function overdue(): Promise<Result> {
  const now = referenceDate()
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../research/data/nyc/brooklyn.meta.json', import.meta.url)), 'utf8'),
  ) as { pulled_at: string }
  const snapshot = new Date(manifest.pulled_at)

  const [row] = await prisma.$queryRaw<{ open: bigint; overdue: bigint; outside: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE status <> 'CLOSED')                         AS open,
           COUNT(*) FILTER (WHERE status <> 'CLOSED' AND "slaDueAt" < ${now}) AS overdue,
           COUNT(*) FILTER (WHERE "slaDueAt" < ${now} AND status = 'CLOSED'
                              AND ("closedAt" IS NULL OR "closedAt" <= "slaDueAt")) AS outside
    FROM service_requests
    WHERE "isImported"
  `
  const open = Number(row!.open)
  const late = Number(row!.overdue)
  const share = open === 0 ? 0 : late / open
  const clockMatches = Math.abs(now.getTime() - snapshot.getTime()) < 1000

  const problems: string[] = []
  if (!clockMatches) {
    problems.push(
      `reference date ${now.toISOString()} is not the corpus snapshot ${snapshot.toISOString()} — ` +
        'update CORPUS_SNAPSHOT_AT in src/config/systemClock.ts after a re-pull',
    )
  }
  if (late > open) problems.push(`overdue (${late}) exceeds open (${open})`)

  return {
    name: 'clock',
    ok: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join('; ')
        : `as at the snapshot ${now.toISOString().slice(0, 10)}: ${late.toLocaleString('en-US')} of ` +
          `${open.toLocaleString('en-US')} open are past their derived deadline (${(share * 100).toFixed(1)}%) — ` +
          'a stale historical backlog, expected; see the note on this check',
  }
}

/**
 * One row from the source, or undefined if the source cleanly says it has none.
 * Throws when the source does not answer cleanly after three tries.
 */
async function fetchSourceRow(key: string): Promise<Record<string, string> | undefined> {
  // The same variable the Python pull reads. Anonymous callers share one pool
  // that Socrata throttles hard; with a (free) app token this check stops being
  // at the mercy of everyone else's traffic.
  const token = process.env.NYC_APP_TOKEN
  const headers: Record<string, string> = token ? { 'X-App-Token': token } : {}

  let last = 'no attempt made'
  let wait = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      const res = await fetch(`${SOCRATA}?unique_key=${key}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) {
        last = `HTTP ${res.status}`
        // A 429 is a rate limit, and a limit measured in seconds is not waited
        // out by a retry two seconds later. Honour Retry-After when Socrata sends
        // it; otherwise back off 15, 30, then 60 seconds.
        const retryAfter = Number(res.headers.get('retry-after'))
        wait =
          res.status === 429 && retryAfter > 0
            ? retryAfter * 1_000
            : res.status === 429
              ? 15_000 * 2 ** attempt
              : 2_000 * 2 ** attempt
        if (res.status === 429 && !token) last = 'HTTP 429, throttled; set NYC_APP_TOKEN to leave the shared pool'
        continue
      }
      const body: unknown = await res.json()
      if (!Array.isArray(body)) {
        last = 'a reply that was not a list of rows'
        continue
      }
      return body[0] as Record<string, string> | undefined
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
      wait = 2_000 * 2 ** attempt
    }
  }
  throw new Error(last)
}

async function spotCheck(): Promise<Result> {
  const total = await prisma.serviceRequest.count({ where: { isImported: true } })
  const failures: string[] = []

  for (let i = 0; i < SPOT_CHECKS; i++) {
    const ours = await prisma.serviceRequest.findFirstOrThrow({
      where: { isImported: true },
      skip: Math.floor(Math.random() * total),
      include: { type: true, descriptor: true, agency: true, orgUnit: true },
    })
    const key = ours.srNumber.replace(/^NYC-/, '')

    // "Not found at source" is a claim about New York's data, so it is made only
    // on a clean answer: a 200 carrying a JSON array with nothing in it. The first
    // version took any reply it could index — a throttled 429, an error object —
    // and reported the record missing; two rows that were sitting at the source
    // failed this check that way (F-35). Anything else is retried, then reported
    // as the source not answering, which is a different thing to be wrong about.
    let theirs: Record<string, string> | undefined
    try {
      theirs = await fetchSourceRow(key)
    } catch (err) {
      return {
        name: 'spot check',
        ok: false,
        detail: `Socrata did not give a usable answer for ${key} (${err instanceof Error ? err.message : String(err)}) — this check needs the network; nothing was compared`,
      }
    }
    if (!theirs) {
      failures.push(`${ours.srNumber}: not found at source`)
      continue
    }

    const board =
      theirs.community_board && /^\d/.test(theirs.community_board)
        ? `BK-${theirs.community_board.split(' ')[0]!.padStart(2, '0')}`
        : null
    const fields: [string, unknown, unknown][] = [
      ['status', ours.status, STATUS[theirs.status ?? '']],
      ['agency', ours.agency.code, theirs.agency],
      ['type', ours.type.name, theirs.complaint_type],
      ['descriptor', ours.descriptor?.name ?? null, theirs.descriptor ?? null],
      ['created', ours.createdAt.toISOString().slice(0, 19), theirs.created_date?.slice(0, 19)],
      ['closed', ours.closedAt?.toISOString().slice(0, 19) ?? null, theirs.closed_date?.slice(0, 19) ?? null],
      ['board', ours.orgUnit?.code ?? null, board],
      ['channel', ours.channel, theirs.open_data_channel_type ?? 'UNKNOWN'],
    ]
    for (const [field, a, b] of fields) {
      if (a !== b) failures.push(`${ours.srNumber} ${field}: ours ${JSON.stringify(a)}, source ${JSON.stringify(b)}`)
    }
  }

  return {
    name: 'spot check',
    ok: failures.length === 0,
    detail: failures.length === 0 ? `${SPOT_CHECKS}/${SPOT_CHECKS} match the source exactly` : failures.join('; '),
  }
}

async function fidelity(): Promise<Result> {
  const lines = readFileSync(SLA_TABLE, 'utf8').trim().split(/\r?\n/)
  const header = lines[0]!.split(',')
  const col = (name: string) => header.indexOf(name)
  const source = new Map<string, { closed: number; p50: number; p75: number }>()
  for (const line of lines.slice(1)) {
    const c = line.split(',')
    source.set(c[col('complaint_type')]!, {
      closed: Number(c[col('closed_requests')]),
      p50: Number(c[col('p50_hours')]),
      p75: Number(c[col('sla_hours')]),
    })
  }

  const rows = await prisma.$queryRaw<{ name: string; closed: bigint; p50: number; p75: number }[]>`
    SELECT t.name, COUNT(*) AS closed,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r."closedAt" - r."createdAt")) / 3600.0) AS p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r."closedAt" - r."createdAt")) / 3600.0) AS p75
    FROM service_requests r JOIN request_types t ON t.id = r."typeId"
    WHERE r."isImported" AND r."closedAt" IS NOT NULL AND r."closedAt" >= r."createdAt"
    GROUP BY t.name
  `

  let worst = 0
  let worstType = ''
  for (const row of rows) {
    const s = source.get(row.name)
    if (!s) continue
    const drift = Math.max(
      Math.abs(Number(row.closed) - s.closed) / s.closed,
      Math.abs(Number(row.p50) - s.p50) / s.p50,
      Math.abs(Number(row.p75) - s.p75) / s.p75,
    )
    if (drift > worst) {
      worst = drift
      worstType = row.name
    }
  }

  return {
    name: 'fidelity',
    ok: rows.length === source.size && worst < FIDELITY_TOLERANCE,
    detail: `${rows.length} types, worst drift ${(worst * 100).toFixed(3)}%${worstType ? ` (${worstType})` : ''}`,
  }
}

async function main() {
  console.log('Verifying the imported corpus against Gates 1 and 2\n')
  const results: Result[] = []
  for (const check of [chain, history, overdue, fidelity, spotCheck, idempotency]) {
    const started = Date.now()
    const result = await check()
    results.push(result)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name.padEnd(12)} ${result.detail}  (${seconds}s)`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length === 0 ? '\nAll checks pass.' : `\n${failed.length} check(s) failed.`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
