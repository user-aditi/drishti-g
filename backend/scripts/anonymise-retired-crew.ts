/**
 * Anonymise the retired field-worker accounts.
 *
 * When street labour moved off logins and onto per-job codes, 120 accounts were
 * switched off but left in place. They are referenced by 121 complaints, 65
 * status-history rows and 5 audit events, so deleting them would blank the
 * worker attribution on real history and punch holes in the audit chain.
 *
 * The rows therefore stay, but stop being accounts: the personal data goes, the
 * credential becomes unusable, and the name reduces to the one fact history
 * still needs — that a crew member of some trade did this work.
 *
 * Idempotent. Matches on the placeholder email domain.
 */
import { PrismaClient, Rank, Trade } from '@prisma/client'
import { randomBytes } from 'node:crypto'

const prisma = new PrismaClient()

/** Never a real domain, so a stray mail send can never reach anyone. */
const RETIRED_DOMAIN = 'retired.invalid'

const TRADE_LABEL: Record<Trade, string> = {
  SAFAI_KARAMCHARI: 'sanitation worker',
  LINEMAN: 'lineman',
  BELDAR: 'beldar',
  MASON: 'mason',
  PLUMBER: 'plumber',
  MALI: 'gardener',
  DRIVER: 'driver',
}

async function main() {
  console.log('--- anonymising retired crew accounts ---')

  const retired = await prisma.user.findMany({
    where: {
      rank: Rank.FIELD_WORKER,
      isActive: false,
      NOT: { email: { endsWith: RETIRED_DOMAIN } },
    },
    include: { postings: { orderBy: { id: 'desc' }, take: 1 } },
  })

  if (retired.length === 0) {
    console.log('nothing to do — all retired accounts are already anonymised')
    return
  }

  let done = 0
  for (const user of retired) {
    const trade = user.postings[0]?.trade
    const label = trade ? TRADE_LABEL[trade] : 'crew member'

    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Enough for history to read sensibly, nothing more.
        fullName: `Former ${label}`,
        fullNameHi: null,
        email: `retired-${user.id}@${RETIRED_DOMAIN}`,
        phone: null,
        // A random hash nobody holds the input to. Cheaper and safer than
        // leaving a real bcrypt hash of a known seed password in place.
        hashedPassword: `disabled:${randomBytes(24).toString('base64url')}`,
        isActive: false,
      },
    })
    done++
  }

  console.log(`anonymised: ${done}`)

  // --- Integrity: history must still resolve ------------------------------
  const [complaints, history, audit, leaked] = await Promise.all([
    prisma.complaint.count({ where: { assignedWorkerId: { not: null } } }),
    prisma.complaintStatusHistory.count({ where: { actorId: { not: null } } }),
    prisma.auditEvent.count({ where: { actorId: { not: null } } }),
    prisma.user.count({
      where: { email: { endsWith: RETIRED_DOMAIN }, OR: [{ phone: { not: null } }] },
    }),
  ])

  console.log(`\nhistory still attributed -> complaints: ${complaints}, status changes: ${history}, audit: ${audit}`)
  console.log(`retired rows still carrying a phone number: ${leaked} (expect 0)`)
  console.log('--- done ---')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
