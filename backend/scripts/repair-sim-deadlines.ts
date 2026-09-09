/**
 * One-off: put escalated complaints' deadlines back on the simulated clock.
 *
 * The 180-day run was produced before `repairEscalatedDeadlines` existed, so its
 * 1,928 escalations all carry deadlines measured from real `now` — leaving a
 * register with thousands of open complaints and none overdue. Re-running six
 * months of traffic to fix one column would be wasteful; this applies the same
 * function the simulator now calls at the end of every run.
 *
 * Safe to run more than once: it recomputes from each complaint's own escalation
 * history rather than adjusting whatever is stored.
 */
import { PrismaClient } from '@prisma/client'
import { assertTimeTravelAllowed, repairEscalatedDeadlines } from './lib/sim-clock.js'
import * as org from '../src/services/orgTree.js'

async function main() {
  assertTimeTravelAllowed()
  const prisma = new PrismaClient()

  const result = await repairEscalatedDeadlines(
    prisma,
    (unitId, departmentId) => org.slaHoursFor(prisma, { unitId, departmentId }),
    0,
  )

  const overdue = await prisma.complaint.count({
    where: {
      slaDueAt: { lt: new Date() },
      status: { in: ['ROUTED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_VERIFICATION'] },
    },
  })

  console.log(`deadlines recomputed: ${result.repaired}`)
  console.log(`open and past deadline across the register: ${overdue}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
