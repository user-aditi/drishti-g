/**
 * Layer 4 — photo verification, and the line it must not cross.
 *
 * The checks here decide whether a crew's submission counts, so the tests are
 * about the ways a submission is not what it claims: nothing attached, a
 * photograph already sent against another job, one taken before the job
 * existed, one taken somewhere else. And about who settles it — the resident
 * first, the officer only when there is no resident to ask or they disagree.
 *
 * Images are generated here rather than fetched: a test that needs a 1.9 GB
 * download to run is a test nobody runs.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { Channel, ProofOutcome, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { assess, sweepSilentCitizens, withCitizenVerdict } from '../src/services/proof.js'
import { dHashOf, hamming, identify } from '../src/services/proofImage.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const HOUR = 3_600_000

const bearer = (id: number, role: Role) => `Bearer ${signToken(id, 'access', role)}`

/** A deterministic photograph-shaped image: smooth gradients, a little noise. */
async function image(seed: number, size = 240): Promise<Buffer> {
  const pixels = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      pixels[i] = (x * 3 + seed * 40) % 256
      pixels[i + 1] = (y * 2 + seed * 17) % 256
      pixels[i + 2] = ((x + y) * seed) % 256
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()
}

let f: Fixture
let officer: number
let otherOfficer: number
let supervisor: number
let requestId: number
let anonymousRequestId: number
let counter = 0

async function staff(name: string, role: Role, unitId: number) {
  const user = await prisma.user.create({
    data: {
      email: `${name.replace(/\W+/g, '.').toLowerCase()}@example.invalid`,
      name,
      passwordHash: 'x',
      role,
      agencyId: f.dot,
      isSynthetic: true,
    },
  })
  await prisma.posting.create({ data: { userId: user.id, agencyId: f.dot, orgUnitId: unitId } })
  return user.id
}

async function serviceRequest(citizenId: number | null) {
  const created = await prisma.serviceRequest.create({
    data: {
      srNumber: `DG-2026-${String(++counter).padStart(6, '0')}`,
      typeId: f.streetType,
      agencyId: f.dot,
      orgUnitId: f.board1,
      citizenId,
      status: RequestStatus.OPEN,
      channel: Channel.ONLINE,
      createdAt: new Date(Date.now() - 2 * HOUR),
      slaDueAt: new Date(Date.now() + 48 * HOUR),
      latitude: 40.68,
      longitude: -73.95,
      assignedOfficerId: officer,
      isImported: false,
    },
  })
  return created.id
}

async function workOrder(onRequest: number, issuedHoursAgo = 1) {
  return prisma.workOrder.create({
    data: {
      requestId: onRequest,
      issuedById: officer,
      code: `TEST-${String(++counter).padStart(4, '0')}`,
      issuedAt: new Date(Date.now() - issuedHoursAgo * HOUR),
      expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
    },
  })
}

async function photo(
  workOrderId: number,
  bytes: Buffer,
  extra: { capturedAt?: Date; exifLat?: number; exifLng?: number } = {},
) {
  const identity = await identify(bytes)
  return prisma.workPhoto.create({
    data: {
      workOrderId,
      storedName: `proof-test-${++counter}.jpg`,
      mimeType: 'image/jpeg',
      bytes: bytes.length,
      sha256: identity.sha256,
      dHash: identity.dHash,
      width: identity.width,
      height: identity.height,
      capturedAt: extra.capturedAt ?? null,
      exifLat: extra.exifLat ?? null,
      exifLng: extra.exifLng ?? null,
    },
  })
}

beforeEach(async () => {
  await reset()
  f = await build()
  officer = await staff('DOT Officer BK-01', Role.OFFICER, f.board1)
  otherOfficer = await staff('DOT Officer BK-02', Role.OFFICER, f.board2)
  supervisor = await staff('DOT Supervisor', Role.SUPERVISOR, f.borough)
  requestId = await serviceRequest(f.citizen)
  anonymousRequestId = await serviceRequest(null)
})

describe('what makes two photographs the same one', () => {
  it('survives re-encoding, resizing and a small crop', async () => {
    const original = await image(1, 320)
    const hash = await dHashOf(original)
    const reEncoded = await sharp(original).jpeg({ quality: 60 }).toBuffer()
    const resized = await sharp(original).resize(160).jpeg().toBuffer()
    const cropped = await sharp(original)
      .extract({ left: 16, top: 16, width: 288, height: 288 })
      .jpeg()
      .toBuffer()

    expect(hamming(hash, await dHashOf(reEncoded))).toBeLessThanOrEqual(2)
    expect(hamming(hash, await dHashOf(resized))).toBeLessThanOrEqual(4)
    expect(hamming(hash, await dHashOf(cropped))).toBeLessThanOrEqual(12)
    // A different picture is not close.
    expect(hamming(hash, await dHashOf(await image(9, 320)))).toBeGreaterThan(12)
  })

  it('says nothing rather than guessing when a file will not decode', async () => {
    expect(await dHashOf(Buffer.from('not an image'))).toBeNull()
    expect(hamming(null, 'ffffffffffffffff')).toBeNull()
    expect(hamming('00ff', 'ff')).toBeNull()
  })
})

describe('the checks', () => {
  it('refuses a submission with nothing attached', async () => {
    const order = await workOrder(requestId)
    const result = await assess(prisma, order.id)
    expect(result.outcome).toBe(ProofOutcome.REJECTED)
    expect(result.checks.find((c) => c.check === 'proof_supplied')!.passed).toBe(false)
  })

  it('refuses a photograph already sent against another job', async () => {
    const bytes = await image(2)
    const first = await workOrder(requestId)
    await photo(first.id, bytes)
    const second = await workOrder(anonymousRequestId)
    await photo(second.id, bytes)

    const result = await assess(prisma, second.id)
    expect(result.outcome).toBe(ProofOutcome.REJECTED)
    const check = result.checks.find((c) => c.check === 'not_recycled')!
    expect(check.passed).toBe(false)
    expect(check.detail).toContain(first.code)
  })

  it('asks the resident when the proof is plausible', async () => {
    const order = await workOrder(requestId)
    await photo(order.id, await image(3), {
      capturedAt: new Date(Date.now() - 30 * 60_000),
      exifLat: 40.6801,
      exifLng: -73.9502,
    })
    const result = await assess(prisma, order.id)
    expect(result.outcome).toBe(ProofOutcome.NEEDS_CITIZEN)
    expect(result.score).toBeGreaterThanOrEqual(90)
    expect(result.checks.find((c) => c.check === 'on_location')!.passed).toBe(true)
    expect(result.checks.find((c) => c.check === 'fresh_capture')!.passed).toBe(true)
  })

  it('goes straight to the officer when nobody reported it by name', async () => {
    const order = await workOrder(anonymousRequestId)
    await photo(order.id, await image(4))
    expect((await assess(prisma, order.id)).outcome).toBe(ProofOutcome.NEEDS_OFFICER)
  })

  it('marks a photograph taken before the job, and one taken elsewhere', async () => {
    const order = await workOrder(requestId, 2)
    await photo(order.id, await image(5), {
      capturedAt: new Date(Date.now() - 5 * HOUR),
      exifLat: 40.75,
      exifLng: -73.99,
    })
    const result = await assess(prisma, order.id)
    expect(result.checks.find((c) => c.check === 'fresh_capture')!.passed).toBe(false)
    expect(result.checks.find((c) => c.check === 'on_location')!.passed).toBe(false)
    expect(result.checks.find((c) => c.check === 'on_location')!.detail).toMatch(/km from where/)
  })

  it('scores missing metadata at half, because most phones strip it', async () => {
    const order = await workOrder(requestId)
    await photo(order.id, await image(6))
    const result = await assess(prisma, order.id)
    const fresh = result.checks.find((c) => c.check === 'fresh_capture')!
    expect(fresh.passed).toBe(false)
    expect(fresh.contribution).toBe(fresh.weight / 2)
    expect(fresh.detail).toMatch(/no capture time/)
  })
})

describe('who settles it', () => {
  it('lets the resident’s answer outrank the checks, either way', async () => {
    const plausible = { score: 60, checks: [], outcome: ProofOutcome.NEEDS_CITIZEN }
    expect(withCitizenVerdict(plausible, true).outcome).toBe(ProofOutcome.CONFIRMED)
    const disputed = withCitizenVerdict(plausible, false)
    expect(disputed.outcome).toBe(ProofOutcome.NEEDS_OFFICER)
    expect(disputed.checks.at(-1)!.detail).toMatch(/says the work was not done/)
  })

  it('confirms strong proof a silent resident never answered, and escalates weak proof', async () => {
    const strong = await workOrder(requestId)
    await prisma.workProof.create({
      data: { workOrderId: strong.id, score: 85, checks: [], outcome: ProofOutcome.NEEDS_CITIZEN },
    })
    const weak = await workOrder(await serviceRequest(f.citizen))
    await prisma.workProof.create({
      data: { workOrderId: weak.id, score: 55, checks: [], outcome: ProofOutcome.NEEDS_CITIZEN },
    })

    // Nothing is decided while the resident still has time.
    expect((await sweepSilentCitizens(prisma)).considered).toBe(0)

    const later = new Date(Date.now() + (env.CITIZEN_GRACE_HOURS + 1) * HOUR)
    const result = await sweepSilentCitizens(prisma, later)
    expect(result).toMatchObject({ considered: 2, confirmed: 1, toOfficer: 1 })
    expect((await prisma.workProof.findUniqueOrThrow({ where: { workOrderId: strong.id } })).outcome).toBe(
      ProofOutcome.CONFIRMED,
    )
    expect((await prisma.workProof.findUniqueOrThrow({ where: { workOrderId: weak.id } })).outcome).toBe(
      ProofOutcome.NEEDS_OFFICER,
    )
  })
})

describe('the crew surface', () => {
  it('records a job done with a photograph, and says what was checked', async () => {
    const order = await workOrder(requestId)
    const res = await request(app)
      .post(`${api}/work-orders/${order.code}/complete`)
      .field('note', 'Filled and rolled.')
      .attach('photos', await image(7), 'done.jpg')
      .expect(200)

    expect(res.body.ok).toBe(true)
    expect(res.body.state).toBe('COMPLETED')
    expect(res.body.proof.outcome).toBe(ProofOutcome.NEEDS_CITIZEN)
    expect(res.body.proof.checks).toHaveLength(5)

    const stored = await prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { photos: true, proof: true },
    })
    expect(stored.completedAt).not.toBeNull()
    expect(stored.completionNote).toBe('Filled and rolled.')
    expect(stored.photos).toHaveLength(1)
    expect(stored.photos[0]!.dHash).toMatch(/^[0-9a-f]{16}$/)
    expect(await prisma.auditEvent.count({ where: { action: 'work_order.completed' } })).toBe(1)
  })

  it('does not record a refused submission as finished', async () => {
    const bytes = await image(8)
    const first = await workOrder(anonymousRequestId)
    await photo(first.id, bytes)

    const order = await workOrder(requestId)
    const res = await request(app)
      .post(`${api}/work-orders/${order.code}/complete`)
      .attach('photos', bytes, 'again.jpg')
      .expect(200)

    expect(res.body.ok).toBe(false)
    expect(res.body.proof.outcome).toBe(ProofOutcome.REJECTED)
    expect(res.body.message).toMatch(/take a new photograph/)
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } })).completedAt).toBeNull()
    expect(await prisma.auditEvent.count({ where: { action: 'work_order.proof_refused' } })).toBe(1)
  })

  it('still takes a completion without photographs, exactly as Layer 1 did', async () => {
    const order = await workOrder(requestId)
    await request(app)
      .post(`${api}/work-orders/${order.code}/complete`)
      .send({ note: 'No camera on this van.' })
      .expect(200)
    const stored = await prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { proof: true },
    })
    expect(stored.completedAt).not.toBeNull()
    expect(stored.proof).toBeNull()
  })
})

describe('the officer’s queue', () => {
  it('holds what needs a person, and nothing that does not', async () => {
    const waiting = await workOrder(anonymousRequestId)
    await photo(waiting.id, await image(10))
    await prisma.workProof.create({
      data: { workOrderId: waiting.id, score: 60, checks: [], outcome: ProofOutcome.NEEDS_OFFICER },
    })
    const settled = await workOrder(requestId)
    await prisma.workProof.create({
      data: { workOrderId: settled.id, score: 95, checks: [], outcome: ProofOutcome.CONFIRMED },
    })

    const res = await request(app)
      .get(`${api}/proof/queue`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .expect(200)
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.rows[0].workOrderId).toBe(waiting.id)

    // Another officer's desk is empty: the queue is scoped to what they answer for.
    const theirs = await request(app)
      .get(`${api}/proof/queue`)
      .set('Authorization', bearer(otherOfficer, Role.OFFICER))
      .expect(200)
    expect(theirs.body.rows).toHaveLength(0)
  })

  it('sends refused work back to the crew, with a reason', async () => {
    const order = await workOrder(requestId)
    await photo(order.id, await image(11))
    await prisma.workOrder.update({ where: { id: order.id }, data: { completedAt: new Date() } })
    await prisma.workProof.create({
      data: { workOrderId: order.id, score: 50, checks: [], outcome: ProofOutcome.NEEDS_OFFICER },
    })

    await request(app)
      .post(`${api}/proof/${order.id}/decide`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ accept: false })
      .expect(400)

    await request(app)
      .post(`${api}/proof/${order.id}/decide`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ accept: false, note: 'The photograph shows the wrong side of the street.' })
      .expect(200)

    const stored = await prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { proof: true },
    })
    expect(stored.completedAt).toBeNull()
    expect(stored.proof!.outcome).toBe(ProofOutcome.REJECTED)
    expect(stored.proof!.decidedById).toBe(officer)
  })

  it('keeps photographs from people with no claim on them', async () => {
    const order = await workOrder(requestId)
    const stored = await photo(order.id, await image(12))

    await request(app)
      .get(`${api}/proof/photo/${stored.storedName}`)
      .set('Authorization', bearer(otherOfficer, Role.OFFICER))
      .expect(403)
    // The supervisor of the agency that owns the request may look.
    await request(app)
      .get(`${api}/proof/photo/${stored.storedName}`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .expect(404) // the row exists, the file does not: this photo was never uploaded through the API
  })
})

describe('the resident', () => {
  it('can confirm the work, and only on their own request', async () => {
    const order = await workOrder(requestId)
    await photo(order.id, await image(13))
    await prisma.workProof.create({
      data: { workOrderId: order.id, score: 75, checks: [], outcome: ProofOutcome.NEEDS_CITIZEN },
    })

    await request(app)
      .post(`${api}/proof/${order.id}/citizen`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .send({ confirmed: true })
      .expect(403)

    const res = await request(app)
      .post(`${api}/proof/${order.id}/citizen`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .send({ confirmed: true })
      .expect(200)
    expect(res.body.outcome).toBe(ProofOutcome.CONFIRMED)
    expect(await prisma.auditEvent.count({ where: { action: 'work_order.citizen_verdict' } })).toBe(1)
  })
})
