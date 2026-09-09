/**
 * Give the demo a believable steady state.
 *
 * The seed placed almost every complaint's deadline in the past. Escalation
 * then does exactly what it should — climbs them — and within a few sweeps the
 * ground floor is empty and everything is sitting at the city. That is correct
 * behaviour on unrealistic data: a real authority receives complaints
 * continuously, so at any moment most are inside their deadline and a minority
 * are not.
 *
 * This reshapes the open complaints into that distribution. It does not touch
 * resolved or closed ones, and it does not rewrite escalation history — what
 * already climbed, climbed.
 *
 *   npm run demo:rebalance
 */
import { PrismaClient } from '@prisma/client'
import * as org from '../src/services/orgTree.js'

const prisma = new PrismaClient()

const OPEN = ['ROUTED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_VERIFICATION'] as const

/** Roughly one in six open complaints is overdue — enough to demonstrate
 *  escalation without the queue being nothing but failures. */
const OVERDUE_SHARE = 0.16

const HOUR = 3_600_000

async function main() {
  console.log('--- rebalancing demo state ---')

  const open = await prisma.complaint.findMany({
    where: { status: { in: [...OPEN] } },
    select: { id: true, departmentId: true, orgUnitId: true, escalationLevel: true },
    orderBy: { id: 'asc' },
  })

  let overdue = 0
  let healthy = 0

  for (const [index, complaint] of open.entries()) {
    // Deterministic rather than random, so a demo is reproducible: every sixth
    // complaint is the overdue one.
    const isOverdue = index % Math.round(1 / OVERDUE_SHARE) === 0

    const layerHours =
      complaint.departmentId != null && complaint.orgUnitId != null
        ? ((await org.slaHoursFor(prisma, {
            unitId: complaint.orgUnitId,
            departmentId: complaint.departmentId,
          })) ?? 48)
        : 48

    // Overdue ones sit a little past their deadline — far enough to be real,
    // not so far that they escalate twice on the next sweep.
    const slaDueAt = isOverdue
      ? new Date(Date.now() - (2 + (index % 9)) * HOUR)
      : new Date(Date.now() + Math.max(4, layerHours - (index % layerHours)) * HOUR)

    await prisma.complaint.update({ where: { id: complaint.id }, data: { slaDueAt } })
    isOverdue ? overdue++ : healthy++
  }

  console.log(`open complaints: ${open.length} -> ${overdue} overdue, ${healthy} within deadline`)

  const byDepth = await prisma.$queryRaw<{ depth: number; open: bigint }[]>`
    select o.depth, count(*) as open
    from complaints c join org_units o on o.id = c."orgUnitId"
    where c.status in ('ROUTED','ASSIGNED','IN_PROGRESS','AWAITING_VERIFICATION')
    group by 1 order by 1`
  console.log('\nopen work by layer:')
  for (const row of byDepth) console.log(`  depth ${row.depth}: ${row.open}`)

  // --- Make the demo accounts demonstrable -------------------------------
  //
  // Ownership was spread thinly across 85 officers, so the accounts on the
  // login screen each held one or two complaints and had nothing to show. This
  // gives each demo officer the open work that already sits at *their* unit in
  // *their* department — precisely what routing would have done had they been
  // the only holder of the post. Nothing moves between units and nothing
  // crosses a jurisdiction.
  const DEMO_OFFICERS = [
    'je.s5.civil@noidaauthority.in',
    'ee.wc5.civil@noidaauthority.in',
    'gm.civil@noidaauthority.in',
  ]

  console.log()
  console.log('concentrating ownership on the demo accounts:')
  for (const email of DEMO_OFFICERS) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { postings: { where: { endedAt: null }, take: 1 } },
    })
    const posting = user?.postings[0]
    if (!user || !posting?.orgUnitId || !posting.departmentId) {
      console.log(`  ${email}: no active posting, skipped`)
      continue
    }

    const moved = await prisma.complaint.updateMany({
      where: {
        orgUnitId: posting.orgUnitId,
        departmentId: posting.departmentId,
        status: { in: [...OPEN] },
      },
      data: { assignedOfficerId: user.id },
    })

    const total = await prisma.complaint.count({
      where: { assignedOfficerId: user.id, status: { in: [...OPEN] } },
    })
    console.log(`  ${email}: now owns ${total} open (${moved.count} reassigned)`)
  }

  console.log('--- done ---')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
