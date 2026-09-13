/**
 * Phase 13 — running it for real.
 *
 * The retention rule for refused photographs, which must delete the pictures
 * without deleting the protection their hashes give; and the registers as CSV,
 * with the same access and filters as the screens they come from.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { Channel, ProofOutcome, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { storedPath } from '../src/middleware/photos.js'
import { sha256Of, dHashOf } from '../src/services/proofImage.js'
import { purgeRefusedPhotos } from '../src/services/proof.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const DAY = 24 * 3_600_000

let f: Fixture
let officer: number
let supervisor: number
let admin: number
let counter = 0

const bearer = (id: number, role: Role) => `Bearer ${signToken(id, 'access', role)}`

async function image(seed: number): Promise<Buffer> {
  const size = 160
  const pixels = Buffer.alloc(size * size * 3)
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * (seed + 3) + seed * 51) % 256
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer()
}

async function staff(name: string, role: Role, agencyId: number | null) {
  const user = await prisma.user.create({
    data: { email: `${name.replace(/\W+/g, '.').toLowerCase()}@example.invalid`, name, passwordHash: 'x', role, agencyId, isSynthetic: true },
  })
  if (agencyId) await prisma.posting.create({ data: { userId: user.id, agencyId, orgUnitId: f.board1 } })
  return user.id
}

async function liveRequest(extra: Record<string, unknown> = {}) {
  return prisma.serviceRequest.create({
    data: {
      srNumber: `DG-2026-${String(++counter).padStart(6, '0')}`,
      typeId: f.streetType,
      agencyId: f.dot,
      orgUnitId: f.board1,
      status: RequestStatus.OPEN,
      channel: Channel.ONLINE,
      createdAt: new Date(Date.now() - 60 * DAY),
      slaDueAt: new Date(Date.now() - 50 * DAY),
      assignedOfficerId: officer,
      isImported: false,
      ...extra,
    },
  })
}

/** A job with one stored photograph, uploaded `daysAgo`, and a proof in the given state. */
async function jobWithPhoto(opts: { daysAgo: number; outcome: ProofOutcome; decided?: boolean; completed?: boolean; seed: number }) {
  const r = await liveRequest()
  const order = await prisma.workOrder.create({
    data: {
      requestId: r.id,
      issuedById: officer,
      code: `P13J-${String(++counter).padStart(4, '0')}`,
      issuedAt: new Date(Date.now() - (opts.daysAgo + 1) * DAY),
      expiresAt: new Date(Date.now() + 14 * DAY),
      completedAt: opts.completed ? new Date(Date.now() - opts.daysAgo * DAY) : null,
    },
  })
  const bytes = await image(opts.seed)
  const storedName = `proof-test-${Date.now()}-${counter}.jpg`
  writeFileSync(storedPath(storedName), bytes)
  const photo = await prisma.workPhoto.create({
    data: {
      workOrderId: order.id,
      storedName,
      mimeType: 'image/jpeg',
      bytes: bytes.length,
      sha256: sha256Of(bytes),
      dHash: await dHashOf(bytes),
      uploadedAt: new Date(Date.now() - opts.daysAgo * DAY),
    },
  })
  await prisma.workProof.create({
    data: {
      workOrderId: order.id,
      score: 10,
      checks: [],
      outcome: opts.outcome,
      ...(opts.decided ? { decidedById: officer, decidedAt: new Date(), decisionNote: 'Sent back.' } : {}),
    },
  })
  return { request: r, order, photo, bytes }
}

beforeEach(async () => {
  await reset()
  f = await build()
  officer = await staff('DOT Officer', Role.OFFICER, f.dot)
  supervisor = await staff('DOT Supervisor', Role.SUPERVISOR, f.dot)
  admin = await staff('Administrator', Role.ADMIN, null)
})

describe('the retention rule for refused photographs', () => {
  it('removes the files of submissions the checks refused, past the retention period, and keeps their rows', async () => {
    const old = await jobWithPhoto({ daysAgo: 40, outcome: ProofOutcome.REJECTED, seed: 1 })
    const recent = await jobWithPhoto({ daysAgo: 5, outcome: ProofOutcome.REJECTED, seed: 2 })
    const accepted = await jobWithPhoto({ daysAgo: 40, outcome: ProofOutcome.CONFIRMED, completed: true, seed: 3 })
    const sentBack = await jobWithPhoto({ daysAgo: 40, outcome: ProofOutcome.REJECTED, decided: true, completed: true, seed: 4 })

    const result = await purgeRefusedPhotos(prisma, new Date(), 30)
    expect(result).toEqual({ purged: 1, missing: 0 })

    expect(existsSync(storedPath(old.photo.storedName))).toBe(false)
    const row = await prisma.workPhoto.findUniqueOrThrow({ where: { id: old.photo.id } })
    expect(row.purgedAt).not.toBeNull()
    expect(row.sha256).toBe(old.photo.sha256)

    for (const kept of [recent, accepted, sentBack]) {
      expect(existsSync(storedPath(kept.photo.storedName))).toBe(true)
    }
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'proof.photos_purged' } })
    expect(event.payload).toMatchObject({ count: 1, retentionDays: 30, jobs: [old.order.code] })

    // Running again finds nothing: the rule is idempotent.
    expect(await purgeRefusedPhotos(prisma, new Date(), 30)).toEqual({ purged: 0, missing: 0 })
  })

  it('says a removed photograph was removed, rather than that it never existed', async () => {
    const old = await jobWithPhoto({ daysAgo: 40, outcome: ProofOutcome.REJECTED, seed: 5 })
    await purgeRefusedPhotos(prisma, new Date(), 30)
    const res = await request(app).get(`${api}/work-orders/${old.order.code}/photo/${old.photo.storedName}`).expect(410)
    expect(res.body.error ?? res.body.message).toMatch(/retention rule/)
  })

  it('still refuses the same photograph sent again after its file was removed', async () => {
    const old = await jobWithPhoto({ daysAgo: 40, outcome: ProofOutcome.REJECTED, seed: 6 })
    await purgeRefusedPhotos(prisma, new Date(), 30)

    const r = await liveRequest()
    const order = await prisma.workOrder.create({
      data: {
        requestId: r.id,
        issuedById: officer,
        code: `P13R-${String(++counter).padStart(4, '0')}`,
        issuedAt: new Date(Date.now() - DAY),
        expiresAt: new Date(Date.now() + 14 * DAY),
      },
    })
    const res = await request(app)
      .post(`${api}/work-orders/${order.code}/complete`)
      .attach('photos', old.bytes, 'again.jpg')
      .expect(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.proof.checks.find((c: { check: string }) => c.check === 'not_recycled').passed).toBe(false)
  })
})

describe('registers as CSV', () => {
  it('exports the agency queue with the screen’s filters, safely for a spreadsheet', async () => {
    await liveRequest({ address: '=HYPERLINK("http://example.invalid")', zip: '11216' })
    await liveRequest({ address: '12 Fulton Street, Brooklyn', status: RequestStatus.CLOSED })
    await liveRequest({ agencyId: f.dsny, typeId: f.sanitationType, address: 'Another agency' })

    const res = await request(app)
      .get(`${api}/requests/export/csv?openOnly=true`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .expect(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="agency-queue-\d{4}-\d{2}-\d{2}\.csv"/)

    const text = res.text
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const lines = text.slice(1).trim().split('\r\n')
    expect(lines[0]).toMatch(/^SR number,Status,Type/)
    // One open DOT request: the closed one and the other agency's are filtered out.
    expect(lines).toHaveLength(2)
    // A formula typed into an address is written as text, quoted because it holds commas and quotes.
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://example.invalid"")"`)

    await request(app).get(`${api}/requests/export/csv`).expect(401)
    await request(app)
      .get(`${api}/requests/export/csv`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .expect(403)
  })

  it('exports the public board rollup, the escalation register, the staff list and the risk register to the right people', async () => {
    const boards = await request(app).get(`${api}/boards/export/csv`).expect(200)
    expect(boards.text).toContain('BK-01,Community Board 1')

    const r = await liveRequest()
    await request(app)
      .post(`${api}/requests/${r.id}/escalate`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ reason: 'Needs a road closure, which is not mine to order.' })
      .expect(200)
    const escalations = await request(app)
      .get(`${api}/escalations/export/csv`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .expect(200)
    expect(escalations.text).toContain(r.srNumber)
    expect(escalations.text).toContain('Needs a road closure')
    await request(app)
      .get(`${api}/escalations/export/csv`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .expect(403)

    const staffCsv = await request(app)
      .get(`${api}/admin/people/export/csv`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)
    expect(staffCsv.text).toContain('DOT Officer')
    expect(staffCsv.text).not.toContain('citizen@example.invalid')
    await request(app)
      .get(`${api}/admin/people/export/csv`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .expect(403)

    // No scores computed in this fixture: said, not an empty file.
    const risk = await request(app)
      .get(`${api}/risk/units/export/csv`)
      .set('Authorization', bearer(admin, Role.ADMIN))
    expect([400, 503]).toContain(risk.status)
  })
})
