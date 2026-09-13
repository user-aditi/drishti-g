/**
 * Layer 1's measurement: what can be observed honestly, and nothing else.
 *
 *   npm run layer1:measure
 *
 * The build plan proposed measuring Layer 1 by whether named accountability
 * changes resolution time on replayed requests. That cannot be done on this
 * data: NYC records no case-worker identity (F-12), so there is no officer
 * behaviour to replay, and a simulated officer would be precisely the invented
 * behaviour the rebuild exists to remove. The result would be whatever the
 * simulation assumed. So Layer 1 is presented as a capability, and measured by
 * four things that are facts about this system rather than claims about NYC:
 *
 *   1. coverage  — every open request has exactly one accountable person who is
 *                  an active officer posted to that request's agency. The gate.
 *   2. latency   — how long this system takes to assign a request it received,
 *                  from filing to first assignment. Imported requests are
 *                  excluded: they were assigned years after NYC filed them, by a
 *                  backfill, and their "latency" would measure when this project
 *                  ran a script.
 *   3. baseline  — no Layer 0 source file references a Layer 1 concept (N5).
 *                  Comments are stripped first, because several Layer 0 files
 *                  explain in prose why officers are absent.
 *   4. chain     — the audit chain still verifies with Layer 1's entries in it.
 *
 * Layer 0 fidelity is `npm run verify:import`, run separately; Layer 1 touches
 * none of the columns it checks.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { verifyChain } from '../src/services/audit.js'
import { checkLayer } from './layering.js'

const prisma = new PrismaClient()


interface Result {
  name: string
  ok: boolean
  detail: string
}

async function coverage(): Promise<Result> {
  const [row] = await prisma.$queryRaw<{ open: bigint; unassigned: bigint; misposted: bigint }[]>`
    SELECT
      COUNT(*) FILTER (WHERE r.status <> 'CLOSED') AS open,
      COUNT(*) FILTER (WHERE r.status <> 'CLOSED' AND r."assignedOfficerId" IS NULL) AS unassigned,
      COUNT(*) FILTER (
        WHERE r.status <> 'CLOSED' AND r."assignedOfficerId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM postings p JOIN users u ON u.id = p."userId"
          WHERE p."userId" = r."assignedOfficerId"
            AND p."agencyId" = r."agencyId"
            AND p."endedAt" IS NULL
            AND u."isActive"
            AND u.role = 'OFFICER'
        )
      ) AS misposted
    FROM service_requests r
  `
  const open = Number(row!.open)
  const unassigned = Number(row!.unassigned)
  const misposted = Number(row!.misposted)
  const covered = open - unassigned - misposted
  return {
    name: 'coverage',
    ok: unassigned === 0 && misposted === 0,
    detail:
      `${covered.toLocaleString('en-US')} of ${open.toLocaleString('en-US')} open requests have exactly one ` +
      `accountable, correctly posted officer (${open === 0 ? '—' : ((covered / open) * 100).toFixed(2) + '%'}); ` +
      `${unassigned} unassigned, ${misposted} held by someone not posted to that agency`,
  }
}

async function latency(): Promise<Result> {
  const [row] = await prisma.$queryRaw<
    { filed: bigint; assigned: bigint; p50: number | null; p95: number | null; max: number | null }[]
  >`
    WITH first AS (SELECT "requestId", MIN(at) AS at FROM assignments GROUP BY "requestId")
    SELECT
      COUNT(*)                                                              AS filed,
      COUNT(f."requestId")                                                  AS assigned,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (f.at - r."createdAt")))
        FILTER (WHERE f."requestId" IS NOT NULL)                            AS p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (f.at - r."createdAt")))
        FILTER (WHERE f."requestId" IS NOT NULL)                            AS p95,
      MAX(EXTRACT(EPOCH FROM (f.at - r."createdAt")))                       AS max
    FROM service_requests r
    LEFT JOIN first f ON f."requestId" = r.id
    WHERE NOT r."isImported"
      -- Only what was filed after Layer 1 went live. A request filed before any
      -- officer was posted was never Layer 1's to assign, and counting it would
      -- report a missing assignment the layer had no chance to make.
      AND r."createdAt" >= (SELECT MIN("createdAt") FROM postings)
      -- Never the demo seed's requests. They are backdated on purpose, so their
      -- "latency" would measure the backdating rather than the system. The seed
      -- marks each filing on the audit chain, which is what identifies them here.
      AND r.id::text NOT IN (
        SELECT a."entityId" FROM audit_events a
        WHERE a.action = 'request.filed' AND a.payload->>'demo' = 'true'
      )
  `
  const filed = Number(row!.filed)
  const assigned = Number(row!.assigned)
  const fmt = (s: number | null) => (s === null ? '—' : s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(2)}s`)
  return {
    name: 'latency',
    ok: true,
    detail:
      filed === 0
        ? 'no requests have been filed through this system since Layer 1 went live, so there is nothing to time yet'
        : `${assigned} of ${filed} requests filed here since Layer 1 went live were assigned; filing to first assignment ` +
          `p50 ${fmt(row!.p50 === null ? null : Number(row!.p50))}, p95 ${fmt(row!.p95 === null ? null : Number(row!.p95))}, ` +
          `max ${fmt(row!.max === null ? null : Number(row!.max))} (imported and demo-seeded requests excluded)`,
  }
}

function baseline(): Result {
  // The file lists and the scan live in layering.ts, shared with CI's check:layering.
  const result = checkLayer(1)
  return { name: 'baseline', ok: result.ok, detail: result.detail }
}

async function chain(): Promise<Result> {
  const result = await verifyChain(prisma)
  return {
    name: 'chain',
    ok: result.valid,
    detail: result.valid ? `${result.checked} entries verify` : `broken at ${result.brokenAtId}: ${result.reason}`,
  }
}

async function main() {
  console.log('Measuring Layer 1 — officer identity\n')
  const results = [await coverage(), await latency(), baseline(), await chain()]
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(9)} ${r.detail}`)
  console.log('\n  Not measured: any change in resolution time. NYC records no case-worker')
  console.log('  identity, so there is no real officer behaviour to compare against (F-12).')
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
