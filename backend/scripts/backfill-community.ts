/**
 * Bring an already-seeded database up to the community-grievance shape.
 *
 * `prisma/seed.ts` produces this from scratch, but it creates complaints rather
 * than upserting them, so re-running it against a live database would double
 * the register. This script does the same job in place and is safe to run more
 * than once: it only ever fills gaps.
 *
 *   npm run backfill:community
 */
import { PrismaClient, Priority, Rank } from '@prisma/client'
import { hashPassword } from '../src/lib/auth.js'
import { OPEN_STATUSES } from '../src/services/gcce.js'
import { priorityForSupport } from '../src/services/community.js'

const prisma = new PrismaClient()

/** Mirrors COMMUNITY_CATEGORIES in the seed. */
const COMMUNITY_CATEGORIES = [
  'GARBAGE',
  'SWEEPING',
  'STREETLIGHT',
  'DRAIN',
  'POTHOLE',
  'FOOTPATH',
  'PUMP',
]

const RESIDENTS_PER_SECTOR = 9

const FIRST_NAMES = [
  'Rakesh', 'Sunil', 'Imran', 'Anita', 'Mohan', 'Farida', 'Ravi', 'Deepak',
  'Sneha', 'Ajay', 'Manju', 'Pawan', 'Geeta', 'Vinod', 'Shabnam', 'Dinesh',
  'Rupali', 'Yogesh', 'Kiran', 'Hemant', 'Suresh', 'Nidhi', 'Tarun', 'Asha',
]
const LAST_NAMES = [
  'Verma', 'Yadav', 'Sheikh', 'Deshmukh', 'Pal', 'Khan', 'Malviya', 'Nair',
  'Chouhan', 'Bhardwaj', 'Rathi', 'Sharma', 'Kashyap', 'Panwar', 'Nagar',
  'Bisht', 'Chandola', 'Gurjar', 'Tomar', 'Dagar', 'Baghel', 'Sisodia',
]

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!

async function main() {
  const hashedPassword = await hashPassword('drishti123')

  // 1. Street-level problems become grievances neighbours can back.
  const marked = await prisma.complaint.updateMany({
    where: {
      isCommunity: false,
      status: { in: OPEN_STATUSES },
      category: { code: { in: COMMUNITY_CATEGORIES } },
    },
    data: { isCommunity: true },
  })
  console.log(`  ${marked.count} open complaints marked as community grievances`)

  // 2. Every sector needs enough residents for backing to mean something.
  const sectors = await prisma.sector.findMany({ select: { id: true, number: true } })
  let created = 0
  for (const sector of sectors) {
    for (let i = 1; i <= RESIDENTS_PER_SECTOR; i++) {
      const email = `resident${i}.s${sector.number}@example.com`
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) continue
      await prisma.user.create({
        data: {
          email,
          hashedPassword,
          fullName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          rank: Rank.CITIZEN,
          homeSectorId: sector.id,
        },
      })
      created++
    }
  }
  console.log(`  ${created} residents created`)

  // 3. Give a share of grievances the backing they would have gathered, so the
  //    thresholds and the priority rule are visible rather than theoretical.
  const grievances = await prisma.complaint.findMany({
    where: { isCommunity: true, status: { in: OPEN_STATUSES } },
    select: { id: true, sectorId: true, citizenId: true, priority: true },
  })

  let supportsAdded = 0
  let raised = 0

  for (const grievance of grievances) {
    if (grievance.sectorId == null) continue

    const already = await prisma.complaintSupport.count({ where: { complaintId: grievance.id } })
    if (already > 0) continue

    const neighbours = await prisma.user.findMany({
      where: {
        rank: Rank.CITIZEN,
        homeSectorId: grievance.sectorId,
        id: { not: grievance.citizenId },
      },
      select: { id: true },
    })
    if (neighbours.length === 0) continue

    // Most grievances gather a little support; a few gather a lot. A flat
    // number would make every threshold fire at once and tell you nothing.
    const roll = Math.random()
    const wanted =
      roll < 0.35 ? 0 : roll < 0.7 ? Math.ceil(Math.random() * 4) : Math.ceil(Math.random() * 12)
    const chosen = neighbours.sort(() => Math.random() - 0.5).slice(0, wanted)
    if (chosen.length === 0) continue

    await prisma.complaintSupport.createMany({
      data: chosen.map((n) => ({ complaintId: grievance.id, userId: n.id })),
      skipDuplicates: true,
    })
    supportsAdded += chosen.length

    const earned = priorityForSupport(chosen.length)
    const rank: Record<Priority, number> = {
      [Priority.LOW]: 0,
      [Priority.MEDIUM]: 1,
      [Priority.HIGH]: 2,
      [Priority.CRITICAL]: 3,
    }
    if (earned && rank[earned] > rank[grievance.priority]) {
      await prisma.complaint.update({ where: { id: grievance.id }, data: { priority: earned } })
      raised++
    }
  }

  console.log(`  ${supportsAdded} supports added across ${grievances.length} grievances`)
  console.log(`  ${raised} grievances raised in priority by their support`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
