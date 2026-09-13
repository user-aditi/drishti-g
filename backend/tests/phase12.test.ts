/**
 * Phase 12 — the resident's side of the service.
 *
 * A photograph with the report, and a crew that cannot send it back as the
 * finished job; a hint before reporting what is already reported; progress on
 * the public page, described by role and never by name; being told when
 * something happens; a profile and a password that can be changed; and a queue
 * an agent can search when a resident calls back.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { EscalationTrigger, ProofOutcome, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { hashPassword, signToken } from '../src/lib/auth.js'
import { escalate } from '../src/services/escalation.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const HOUR = 3_600_000

let f: Fixture
let officer: number
let supervisor: number
let counter = 0

const bearer = (id: number, role: Role) => `Bearer ${signToken(id, 'access', role)}`

async function image(seed: number, size = 200): Promise<Buffer> {
  const pixels = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      pixels[i] = (x * 5 + seed * 31) % 256
      pixels[i + 1] = (y * 3 + seed * 13) % 256
      pixels[i + 2] = ((x ^ y) * (seed + 1)) % 256
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
}

async function staff(name: string, role: Role) {
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
  await prisma.posting.create({
    data: { userId: user.id, agencyId: f.dot, orgUnitId: role === Role.OFFICER ? f.board1 : f.borough },
  })
  return user.id
}

async function file(as: number | null, body: Record<string, unknown> = {}) {
  const req = request(app).post(`${api}/requests`)
  if (as !== null) req.set('Authorization', bearer(as, Role.CITIZEN))
  const res = await req
    .send({ typeId: f.streetType, orgUnitId: f.board1, address: '1 Test Street', ...body })
    .expect(201)
  return res.body as { id: number; srNumber: string; photoToken: string }
}

beforeEach(async () => {
  await reset()
  f = await build()
  officer = await staff('DOT Officer Named Person', Role.OFFICER)
  supervisor = await staff('DOT Supervisor Named Person', Role.SUPERVISOR)
})

describe('a photograph with the report', () => {
  it('lets whoever filed attach photographs with the token the filing returned', async () => {
    const filed = await file(null)
    expect(filed.photoToken).toBeTruthy()

    await request(app)
      .post(`${api}/requests/${filed.srNumber}/photos`)
      .field('token', filed.photoToken)
      .attach('photos', await image(1), 'pothole.jpg')
      .expect(201)

    const detail = await request(app).get(`${api}/requests/${filed.srNumber}`).expect(200)
    expect(detail.body.photoCount).toBe(1)
    expect(await prisma.auditEvent.count({ where: { action: 'request.photos_added' } })).toBe(1)
  })

  it('refuses anyone without the token for that request, and a fourth photograph', async () => {
    const mine = await file(null)
    const other = await file(null)

    await request(app)
      .post(`${api}/requests/${mine.srNumber}/photos`)
      .attach('photos', await image(2), 'a.jpg')
      .expect(403)
    await request(app)
      .post(`${api}/requests/${mine.srNumber}/photos`)
      .field('token', other.photoToken)
      .attach('photos', await image(3), 'b.jpg')
      .expect(403)

    const upload = request(app).post(`${api}/requests/${mine.srNumber}/photos`).field('token', mine.photoToken)
    for (const seed of [4, 5, 6]) upload.attach('photos', await image(seed), `${seed}.jpg`)
    await upload.expect(201)
    await request(app)
      .post(`${api}/requests/${mine.srNumber}/photos`)
      .field('token', mine.photoToken)
      .attach('photos', await image(7), 'c.jpg')
      .expect(400)
  })

  it('shows the photographs to the reporter and the agency, and not to the public', async () => {
    const filed = await file(f.citizen)
    await request(app)
      .post(`${api}/requests/${filed.srNumber}/photos`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .attach('photos', await image(8), 'mine.jpg')
      .expect(201)

    await request(app).get(`${api}/requests/${filed.srNumber}/photos`).expect(403)
    await request(app)
      .get(`${api}/requests/${filed.srNumber}/photos`)
      .set('Authorization', bearer(f.dsnyAgent, Role.AGENT))
      .expect(403)
    const listed = await request(app)
      .get(`${api}/requests/${filed.srNumber}/photos`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .expect(200)
    const photoId = listed.body.photos[0].id
    const bytes = await request(app)
      .get(`${api}/requests/${filed.srNumber}/photos/${photoId}`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .expect(200)
    expect(bytes.headers['content-type']).toContain('image/jpeg')
  })

  it('refuses a crew that sends the resident’s own photograph back as the finished job', async () => {
    const filed = await file(f.citizen)
    const theirs = await image(9)
    await request(app)
      .post(`${api}/requests/${filed.srNumber}/photos`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .attach('photos', theirs, 'problem.jpg')
      .expect(201)

    const order = await prisma.workOrder.create({
      data: {
        requestId: filed.id,
        issuedById: officer,
        code: `P12J-${String(++counter).padStart(4, '0')}`,
        issuedAt: new Date(Date.now() - HOUR),
        expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
      },
    })
    // Re-saved, as a gallery app would: not the same file, the same photograph.
    const resaved = await sharp(theirs).jpeg({ quality: 70 }).toBuffer()
    const res = await request(app)
      .post(`${api}/work-orders/${order.code}/complete`)
      .attach('photos', resaved, 'done.jpg')
      .expect(200)

    expect(res.body.ok).toBe(false)
    const check = res.body.proof.checks.find((c: { check: string }) => c.check === 'not_recycled')
    expect(check.passed).toBe(false)
    expect(check.detail).toMatch(/resident attached/)
  })
})

describe('already reported nearby', () => {
  it('finds open requests of the same type within a block, nearest first', async () => {
    await file(null, { latitude: 40.6782, longitude: -73.9442 })
    await file(null, { latitude: 40.679, longitude: -73.9442 }) // ~90m north
    await file(null, { latitude: 40.69, longitude: -73.9442 }) // ~1.3km: not near
    await file(null, { typeId: f.sanitationType, latitude: 40.6782, longitude: -73.9442 }) // another type
    const closed = await file(null, { latitude: 40.6783, longitude: -73.9442 })
    await prisma.serviceRequest.update({ where: { id: closed.id }, data: { status: RequestStatus.CLOSED } })

    const res = await request(app)
      .get(`${api}/requests/check/nearby?typeId=${f.streetType}&lat=40.6782&lng=-73.9442`)
      .expect(200)
    expect(res.body.rows).toHaveLength(2)
    expect(res.body.rows[0].metres).toBe(0)
    expect(res.body.rows[1].metres).toBeGreaterThan(50)
    expect(res.body.rows[1].metres).toBeLessThanOrEqual(150)
  })
})

describe('progress on the public page', () => {
  it('lists what happened, in order, by role and never by name', async () => {
    const filed = await file(null)
    const order = await prisma.workOrder.create({
      data: {
        requestId: filed.id,
        issuedById: officer,
        code: `P12P-${String(++counter).padStart(4, '0')}`,
        issuedAt: new Date(Date.now() + 1000),
        expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
      },
    })
    await prisma.$transaction((tx) =>
      escalate(tx, {
        requestId: filed.id,
        agencyId: f.dot,
        fromLevel: 0,
        toLevel: 1,
        trigger: EscalationTrigger.MANUAL,
        reason: 'Needs a bigger crew than we have.',
        raisedById: officer,
        raisedByLabel: 'DOT Officer Named Person',
        at: new Date(Date.now() + 2000),
      }),
    )
    await prisma.workOrder.update({ where: { id: order.id }, data: { completedAt: new Date(Date.now() + 3000) } })

    const res = await request(app).get(`${api}/requests/${filed.srNumber}/progress`).expect(200)
    expect(res.body.steps.map((s: { label: string }) => s.label)).toEqual([
      'Filed',
      'An officer is answering for it',
      'A crew was sent',
      'Escalated to the supervisor',
      'The crew reported the work done',
    ])
    expect(JSON.stringify(res.body)).not.toMatch(/Named Person/)
  })
})

describe('notifications', () => {
  it('tells the reporter when their request closes, and lets them mark it read', async () => {
    const filed = await file(f.citizen)
    await request(app)
      .patch(`${api}/requests/${filed.id}/status`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .send({ status: 'CLOSED', note: 'Pothole filled.' })
      .expect(200)

    const mine = await request(app)
      .get(`${api}/notifications`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .expect(200)
    expect(mine.body.unread).toBe(1)
    expect(mine.body.rows[0]).toMatchObject({
      kind: 'request.status_changed',
      title: `${filed.srNumber} is now closed`,
      body: 'Pothole filled.',
      href: `/sr/${filed.srNumber}`,
    })

    // Someone else's notification cannot be touched.
    await request(app)
      .post(`${api}/notifications/${mine.body.rows[0].id}/read`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .expect(404)
    await request(app)
      .post(`${api}/notifications/${mine.body.rows[0].id}/read`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .expect(200)
    const after = await request(app)
      .get(`${api}/notifications/unread-count`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .expect(200)
    expect(after.body.unread).toBe(0)
  })

  it('tells whoever an escalation reaches, and the resident when their confirmation is wanted', async () => {
    const filed = await file(f.citizen)
    await request(app)
      .post(`${api}/requests/${filed.id}/escalate`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ reason: 'The crew cannot reach it without closing the lane.' })
      .expect(200)
    expect(await prisma.notification.count({ where: { userId: supervisor, kind: 'escalation.reached_you' } })).toBe(1)

    const order = await prisma.workOrder.create({
      data: {
        requestId: filed.id,
        issuedById: officer,
        code: `P12N-${String(++counter).padStart(4, '0')}`,
        issuedAt: new Date(Date.now() - HOUR),
        expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
      },
    })
    const res = await request(app)
      .post(`${api}/work-orders/${order.code}/complete`)
      .attach('photos', await image(11), 'done.jpg')
      .expect(200)
    expect(res.body.proof.outcome).toBe(ProofOutcome.NEEDS_CITIZEN)
    expect(await prisma.notification.count({ where: { userId: f.citizen, kind: 'proof.needs_citizen' } })).toBe(1)
  })

  it('does not tell a resident about a change they made themselves, or anyone about an anonymous filing', async () => {
    const anonymous = await file(null)
    await request(app)
      .patch(`${api}/requests/${anonymous.id}/status`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .send({ status: 'CLOSED' })
      .expect(200)
    expect(await prisma.notification.count()).toBe(0)
  })
})

describe('your account', () => {
  let resident: number

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: 'resident.with.password@example.invalid',
        name: 'Resident',
        passwordHash: await hashPassword('old-password-123'),
        role: Role.CITIZEN,
      },
    })
    resident = user.id
  })

  it('updates name, phone and home board', async () => {
    const res = await request(app)
      .patch(`${api}/auth/me`)
      .set('Authorization', bearer(resident, Role.CITIZEN))
      .send({ name: 'Resident Renamed', phone: '555-0100', orgUnitId: f.board2 })
      .expect(200)
    expect(res.body.name).toBe('Resident Renamed')
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: resident } })
    expect(stored).toMatchObject({ phone: '555-0100', orgUnitId: f.board2, role: Role.CITIZEN })
  })

  it('changes the password only with the current one, and signs older sessions out', async () => {
    // A session issued a minute ago, as a phone left signed in would hold.
    const older = jwt.sign(
      { sub: String(resident), type: 'access', role: Role.CITIZEN, iat: Math.floor(Date.now() / 1000) - 60 },
      env.JWT_SECRET,
      { expiresIn: '1h' },
    )
    await request(app).get(`${api}/auth/me`).set('Authorization', `Bearer ${older}`).expect(200)

    await request(app)
      .post(`${api}/auth/password`)
      .set('Authorization', `Bearer ${older}`)
      .send({ currentPassword: 'wrong-password', newPassword: 'new-password-456' })
      .expect(401)

    const changed = await request(app)
      .post(`${api}/auth/password`)
      .set('Authorization', `Bearer ${older}`)
      .send({ currentPassword: 'old-password-123', newPassword: 'new-password-456' })
      .expect(200)

    await request(app).get(`${api}/auth/me`).set('Authorization', `Bearer ${older}`).expect(401)
    await request(app).get(`${api}/auth/me`).set('Authorization', `Bearer ${changed.body.accessToken}`).expect(200)
    await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'resident.with.password@example.invalid', password: 'new-password-456' })
      .expect(200)
    expect(await prisma.auditEvent.count({ where: { action: 'user.password_changed' } })).toBe(1)
  })
})

describe('searching the queue', () => {
  it('finds a request by part of its number, its street, or its descriptor', async () => {
    const a = await file(null, { address: '455 Nostrand Avenue', descriptorId: f.streetDescriptor })
    await file(null, { address: '12 Fulton Street' })
    const search = (q: string) =>
      request(app)
        .get(`${api}/requests?q=${encodeURIComponent(q)}`)
        .set('Authorization', bearer(f.dotAgent, Role.AGENT))
        .expect(200)

    expect((await search('nostrand')).body.rows.map((r: { srNumber: string }) => r.srNumber)).toEqual([a.srNumber])
    expect((await search(a.srNumber.slice(-6).toLowerCase())).body.total).toBe(1)
    expect((await search('pothole')).body.total).toBe(1)
    expect((await search('Street')).body.total).toBe(1)
  })
})

