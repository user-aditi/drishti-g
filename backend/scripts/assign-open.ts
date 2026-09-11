/**
 * Give every open request an accountable officer — Layer 1's backfill.
 *
 *   npm run layer1:assign
 *
 * New filings are assigned inside their own filing transaction. The 6,315
 * requests that were already open when Layer 1 arrived need the same rule run
 * over them once, and this is that run.
 *
 * Every assignment is stamped with the real time it is made. That is the honest
 * choice and it has a visible consequence: an imported request filed in 2022
 * shows an `assignedAt` in 2026. It does not claim anyone held that request in
 * 2022 — NYC records no owner, and backdating one would be inventing who worked
 * it — and it is why the latency measure in `measure-layer1.ts` excludes
 * imported requests entirely.
 *
 * Idempotent: a request that already has an officer is left alone. Each
 * assignment gets its own audit entry, because each is a distinct act by this
 * system and the chain is the record of this system's acts.
 */
import { AssignmentSource, PrismaClient, RequestStatus } from '@prisma/client'
import { assign, officerFor } from '../src/services/assignment.js'

const prisma = new PrismaClient()
const BATCH = 250

async function main() {
  const open = await prisma.serviceRequest.findMany({
    where: { status: { not: RequestStatus.CLOSED }, assignedOfficerId: null },
    select: { id: true, agencyId: true, orgUnitId: true },
    orderBy: { id: 'asc' },
  })
  console.log(`Layer 1 backfill: ${open.length.toLocaleString('en-US')} open requests without an officer`)

  let assigned = 0
  let nobodyPosted = 0
  const started = Date.now()

  for (let i = 0; i < open.length; i += BATCH) {
    const batch = open.slice(i, i + BATCH)
    const counts = await prisma.$transaction(
      async (tx) => {
        let a = 0
        let n = 0
        for (const request of batch) {
          const officerId = await officerFor(tx, request.agencyId, request.orgUnitId)
          if (officerId === null) {
            n++
            continue
          }
          await assign(tx, {
            requestId: request.id,
            officerId,
            byUserId: null,
            byLabel: 'posting rule (Layer 1 backfill)',
            source: AssignmentSource.POSTING_RULE,
          })
          a++
        }
        return { a, n }
      },
      { maxWait: 30_000, timeout: 300_000 },
    )
    assigned += counts.a
    nobodyPosted += counts.n
    process.stdout.write(
      `\r  ${Math.min(i + BATCH, open.length).toLocaleString('en-US')} processed | ` +
        `${assigned.toLocaleString('en-US')} assigned | ${nobodyPosted} with nobody posted`,
    )
  }
  process.stdout.write('\n')

  const remaining = await prisma.serviceRequest.count({
    where: { status: { not: RequestStatus.CLOSED }, assignedOfficerId: null },
  })
  console.log(`  elapsed    ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`  remaining  ${remaining} open requests with no officer`)
  if (remaining > 0) {
    console.log('  Those are counterexamples to the Layer 1 gate. Post an officer to their board,')
    console.log('  or to the borough for their agency, and run this again.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
