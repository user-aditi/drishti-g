/**
 * Retire field-worker accounts into crew records.
 *
 * The old model gave every safai karamchari a departmental login. That was
 * never how municipal labour works — most of it is contractual and rotates —
 * and it made the org chart claim a permanence the authority does not have.
 *
 * This moves each of them onto the roll of the Section Officer who actually
 * supervises them, and switches off the account. The User rows stay: historical
 * complaints reference them as `assignedWorkerId`, and a service record that
 * evaporates when the model changes is worse than a slightly untidy one.
 *
 *   npm run migrate:crew
 */
import { PrismaClient, Rank, WorkOrderStatus } from '@prisma/client'
import { generateCode, CODE_TTL_DAYS } from '../src/services/workOrder.js'
import { OPEN_STATUSES } from '../src/services/gcce.js'

const prisma = new PrismaClient()

async function main() {
  const workers = await prisma.user.findMany({
    where: { rank: Rank.FIELD_WORKER },
    include: {
      postings: {
        where: { endedAt: null },
        include: { sector: true, department: true },
      },
    },
  })

  let created = 0
  let skipped = 0
  const crewByUserId = new Map<number, number>()

  for (const worker of workers) {
    const posting = worker.postings[0]
    if (!posting?.sectorId || !posting.departmentId || !posting.trade) {
      skipped++
      continue
    }

    // The Section Officer for the same sector and department is the person who
    // actually hands this worker their jobs.
    const supervisor = await prisma.posting.findFirst({
      where: {
        rank: Rank.SECTION_OFFICER,
        sectorId: posting.sectorId,
        departmentId: posting.departmentId,
        endedAt: null,
      },
      select: { userId: true },
    })
    if (!supervisor) {
      skipped++
      continue
    }

    const existing = await prisma.crew.findFirst({
      where: {
        fullName: worker.fullName,
        sectorId: posting.sectorId,
        departmentId: posting.departmentId,
      },
    })
    if (existing) {
      crewByUserId.set(worker.id, existing.id)
      continue
    }

    const crew = await prisma.crew.create({
      data: {
        fullName: worker.fullName,
        phone: worker.phone,
        trade: posting.trade,
        supervisorId: supervisor.userId,
        sectorId: posting.sectorId,
        departmentId: posting.departmentId,
      },
    })
    crewByUserId.set(worker.id, crew.id)
    created++
  }

  console.log(`  ${created} crew records created, ${skipped} workers skipped (no posting or supervisor)`)

  // Jobs already in flight need a code, or the work in progress becomes
  // unreachable the moment the worker portal goes away.
  const inFlight = await prisma.complaint.findMany({
    where: {
      assignedWorkerId: { not: null },
      status: { in: OPEN_STATUSES },
      workOrders: { none: {} },
    },
    select: { id: true, assignedWorkerId: true, assignedOfficerId: true, status: true },
  })

  let orders = 0
  for (const complaint of inFlight) {
    const crewId = crewByUserId.get(complaint.assignedWorkerId!) ?? null
    const issuedById = complaint.assignedOfficerId
    if (!issuedById) continue

    await prisma.workOrder.create({
      data: {
        complaintId: complaint.id,
        crewId,
        code: await generateCode(prisma),
        // Anything already reported done keeps that state; the rest are live.
        status:
          complaint.status === 'AWAITING_VERIFICATION'
            ? WorkOrderStatus.SUBMITTED
            : WorkOrderStatus.OPENED,
        issuedById,
        expiresAt: new Date(Date.now() + CODE_TTL_DAYS * 86_400_000),
        instructions: 'Carried over from the previous worker-account model.',
      },
    })
    orders++
  }
  console.log(`  ${orders} work orders created for jobs already in flight`)

  // The accounts stop being a way in. The rows stay for history.
  const disabled = await prisma.user.updateMany({
    where: { rank: Rank.FIELD_WORKER, isActive: true },
    data: { isActive: false },
  })
  console.log(`  ${disabled.count} field-worker logins disabled`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
