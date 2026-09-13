/**
 * What the end-to-end tests need before they open a browser.
 *
 *   npm run e2e:setup        (Playwright's global setup runs this)
 *
 * One signed-in session per role, written as Playwright storage state. Signed
 * with the backend's own key from accounts read out of the database — the same
 * approach as the page audit — so no test types a password into a form and no
 * password is written down anywhere. The seeded accounts must exist
 * (`npm run seed`).
 *
 * Fresh photographs for every run. The recycled-photograph check would rightly
 * refuse a crew that sends the same picture twice, so a fixed test image would
 * pass once and fail forever after.
 *
 * And the ids the tests file against, read from the database rather than
 * hardcoded, so a re-seed cannot leave the tests pointing at nothing.
 */
import { randomBytes, randomInt } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Role } from '@prisma/client'
import sharp from 'sharp'
import { ACCESS_COOKIE, hashPassword, signToken } from '../src/lib/auth.js'
import { prisma } from '../src/lib/prisma.js'

const AUTH = fileURLToPath(new URL('../../frontend/e2e/.auth/', import.meta.url))
const TMP = fileURLToPath(new URL('../../frontend/e2e/.tmp/', import.meta.url))
const PHOTOS = 8

const ACCOUNTS = {
  citizen: 'resident@synthetic.drishti.invalid',
  agent: 'dot.agent@synthetic.drishti.invalid',
  officer: 'dot.officer.bk04@synthetic.drishti.invalid',
  supervisor: 'dot.supervisor@synthetic.drishti.invalid',
  commissioner: 'dot.commissioner@synthetic.drishti.invalid',
  admin: 'admin@synthetic.drishti.invalid',
} as const

/** Playwright storage state holding a session cookie for one account. */
function storageFor(userId: number, role: Role) {
  return {
    cookies: [
      {
        name: ACCESS_COOKIE,
        value: signToken(userId, 'access', role),
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  }
}

async function photograph(): Promise<Buffer> {
  const size = 320
  const pixels = Buffer.alloc(size * size * 3)
  const [a, b, c] = [randomInt(1, 250), randomInt(1, 250), randomInt(1, 250)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      pixels[i] = (x * a + y * 3) % 256
      pixels[i + 1] = (y * b + x) % 256
      pixels[i + 2] = ((x ^ y) * c) % 256
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 85 }).toBuffer()
}

/**
 * An officer that exists only for the administrator's journey, reset every run.
 *
 * Moving or deactivating a seeded officer would hand their imported requests to
 * someone else in whatever database the tests run against. This one starts every
 * run deactivated — so the posting rule never gives it work — and posted to BK-18,
 * and has no password anyone could sign in with. The journey reactivates it,
 * moves it, and deactivates it again.
 */
async function spareOfficer(agencyId: number, orgUnitId: number): Promise<number> {
  const email = 'e2e.spare.officer@synthetic.drishti.invalid'
  const user = await prisma.user.upsert({
    where: { email },
    update: { isActive: false, agencyId },
    create: {
      email,
      name: 'E2E Spare Officer',
      // Not a bcrypt hash, so no password matches it.
      passwordHash: '!e2e-no-password',
      role: 'OFFICER',
      agencyId,
      isSynthetic: true,
      isActive: false,
    },
  })
  const at = new Date()
  await prisma.posting.updateMany({ where: { userId: user.id, endedAt: null }, data: { endedAt: at } })
  await prisma.posting.create({ data: { userId: user.id, agencyId, orgUnitId, startedAt: at } })
  return user.id
}

/**
 * A resident kept for the account journey, which changes a password — something
 * no test may do to a seeded account someone signs in with. Reset every run to
 * a fresh random password.
 */
async function accountResident(): Promise<{ id: number; password: string }> {
  const email = 'e2e.account.resident@synthetic.drishti.invalid'
  const password = randomBytes(12).toString('base64url')
  const passwordHash = await hashPassword(password)
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, passwordChangedAt: null, name: 'E2E Account Resident', isActive: true },
    create: { email, passwordHash, name: 'E2E Account Resident', role: 'CITIZEN', isSynthetic: true },
  })
  return { id: user.id, password }
}

async function main() {
  mkdirSync(AUTH, { recursive: true })
  mkdirSync(TMP, { recursive: true })

  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error(`${email} is not in the database — run \`npm run seed\` first`)
    writeFileSync(`${AUTH}${role}.json`, JSON.stringify(storageFor(user.id, user.role), null, 2))
  }

  for (let i = 1; i <= PHOTOS; i++) writeFileSync(`${TMP}photo-${i}.jpg`, await photograph())

  const [type, board, spareFrom, spareTo, dot] = await Promise.all([
    prisma.requestType.findFirstOrThrow({ where: { name: 'Street Condition' }, select: { id: true } }),
    prisma.orgUnit.findFirstOrThrow({ where: { code: 'BK-04' }, select: { id: true } }),
    prisma.orgUnit.findFirstOrThrow({ where: { code: 'BK-18' }, select: { id: true } }),
    prisma.orgUnit.findFirstOrThrow({ where: { code: 'BK-17' }, select: { id: true } }),
    prisma.agency.findFirstOrThrow({ where: { code: 'DOT' }, select: { id: true } }),
  ])
  const spare = await spareOfficer(dot.id, spareFrom.id)
  const account = await accountResident()
  writeFileSync(`${AUTH}account.json`, JSON.stringify(storageFor(account.id, 'CITIZEN'), null, 2))
  writeFileSync(
    `${TMP}ids.json`,
    JSON.stringify(
      {
        streetConditionTypeId: type.id,
        bk04BoardId: board.id,
        dotAgencyId: dot.id,
        spareOfficerId: spare,
        spareFromBoardId: spareFrom.id,
        spareToBoardId: spareTo.id,
        // A throwaway password for a throwaway account, regenerated every run and
        // written only to the git-ignored .tmp folder.
        accountPassword: account.password,
      },
      null,
      2,
    ),
  )

  console.log(`e2e setup: ${Object.keys(ACCOUNTS).length} sessions, ${PHOTOS} fresh photographs, ids written`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
