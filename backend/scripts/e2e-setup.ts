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
import { randomInt } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { ACCESS_COOKIE, signToken } from '../src/lib/auth.js'
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

async function main() {
  mkdirSync(AUTH, { recursive: true })
  mkdirSync(TMP, { recursive: true })

  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error(`${email} is not in the database — run \`npm run seed\` first`)
    const state = {
      cookies: [
        {
          name: ACCESS_COOKIE,
          value: signToken(user.id, 'access', user.role),
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
    writeFileSync(`${AUTH}${role}.json`, JSON.stringify(state, null, 2))
  }

  for (let i = 1; i <= PHOTOS; i++) writeFileSync(`${TMP}photo-${i}.jpg`, await photograph())

  const [type, board] = await Promise.all([
    prisma.requestType.findFirstOrThrow({ where: { name: 'Street Condition' }, select: { id: true } }),
    prisma.orgUnit.findFirstOrThrow({ where: { code: 'BK-04' }, select: { id: true } }),
  ])
  writeFileSync(`${TMP}ids.json`, JSON.stringify({ streetConditionTypeId: type.id, bk04BoardId: board.id }, null, 2))

  console.log(`e2e setup: ${Object.keys(ACCOUNTS).length} sessions, ${PHOTOS} fresh photographs, ids written`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
