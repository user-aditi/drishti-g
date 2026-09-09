/**
 * Collapse the eight-value Rank ladder into three roles, and finish the
 * field-worker retirement that `workers-to-crew.ts` started.
 *
 * Seniority is no longer a rank — it is depth in the org tree. What is left is
 * a capability question with three answers: the public, someone posted to a
 * unit, and the system owner.
 *
 * Idempotent.
 */
import { PrismaClient, Rank, Role } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('--- collapsing ranks into roles ---')

  // 1. Roles ----------------------------------------------------------------
  const citizens = await prisma.user.updateMany({
    where: { rank: Rank.CITIZEN },
    data: { role: Role.CITIZEN },
  })
  const admins = await prisma.user.updateMany({
    where: { rank: Rank.SUPER_ADMIN },
    data: { role: Role.SUPER_ADMIN },
  })
  // Everyone else who holds a post is simply an officer. Field workers are
  // included: their accounts are already switched off, and leaving them as
  // CITIZEN would be a lie about what the account once was.
  const officers = await prisma.user.updateMany({
    where: { rank: { notIn: [Rank.CITIZEN, Rank.SUPER_ADMIN] } },
    data: { role: Role.OFFICER },
  })
  console.log(`roles -> citizens: ${citizens.count}, officers: ${officers.count}, admins: ${admins.count}`)

  // 2. Retire field-worker postings -----------------------------------------
  // The accounts were deactivated when crew records were created, but their
  // postings were left open, so every org-chart count still included them.
  const crewCount = await prisma.crew.count()
  const openWorkerPostings = await prisma.posting.count({
    where: { rank: Rank.FIELD_WORKER, endedAt: null },
  })

  if (openWorkerPostings > 0 && crewCount === 0) {
    throw new Error('refusing to retire worker postings: no crew records exist to replace them')
  }

  const retired = await prisma.posting.updateMany({
    where: { rank: Rank.FIELD_WORKER, endedAt: null },
    data: { endedAt: new Date() },
  })
  console.log(`field-worker postings retired: ${retired.count} (crew records on file: ${crewCount})`)

  // 3. Place historical escalations on the tree ------------------------------
  // Old rows recorded a rank pair, and old escalation only changed the assigned
  // officer — it never moved the complaint's location. So the complaint's unit
  // is where the escalation started FROM, and the parent is where it went TO.
  const escalations = await prisma.escalation.findMany({
    where: { toUnitId: null },
    include: { complaint: { select: { orgUnitId: true } } },
  })

  let placed = 0
  for (const esc of escalations) {
    const unitId = esc.complaint?.orgUnitId
    if (unitId == null) continue

    const unit = await prisma.orgUnit.findUnique({ where: { id: unitId } })
    if (!unit?.parentId) continue

    await prisma.escalation.update({
      where: { id: esc.id },
      data: { fromUnitId: unit.id, toUnitId: unit.parentId },
    })
    placed++
  }
  // Second pass: a complaint that has since climbed to the root leaves its
  // oldest escalation unplaceable by the rule above. Infer it from the chain —
  // an escalation ends where the next one begins.
  const stranded = await prisma.escalation.findMany({
    where: { toUnitId: null },
    select: { id: true, complaintId: true, createdAt: true },
  })
  let inferred = 0
  for (const esc of stranded) {
    const next = await prisma.escalation.findFirst({
      where: {
        complaintId: esc.complaintId,
        createdAt: { gt: esc.createdAt },
        fromUnitId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { fromUnitId: true },
    })
    if (!next?.fromUnitId) continue

    // Old escalations were rank hops that never moved the complaint, so this
    // one started where the next one did and went one level up from there.
    const origin = await prisma.orgUnit.findUnique({ where: { id: next.fromUnitId } })
    if (!origin?.parentId) continue

    await prisma.escalation.update({
      where: { id: esc.id },
      data: { fromUnitId: origin.id, toUnitId: origin.parentId },
    })
    inferred++
  }

  console.log(
    `historical escalations placed on tree: ${placed}/${escalations.length}` +
      (inferred ? ` (+${inferred} inferred from the chain)` : ''),
  )

  // 4. Integrity ------------------------------------------------------------
  const byRole = await prisma.user.groupBy({ by: ['role'], _count: true })
  console.log('\nfinal roles:', byRole.map((r) => `${r.role}=${r._count}`).join(', '))

  const stillOpen = await prisma.posting.count({
    where: { rank: Rank.FIELD_WORKER, endedAt: null },
  })
  const activeOfficers = await prisma.posting.count({
    where: { endedAt: null, user: { isActive: true } },
  })
  console.log(`open field-worker postings: ${stillOpen} (expect 0)`)
  console.log(`active postings remaining: ${activeOfficers}`)
  console.log('--- done ---')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
