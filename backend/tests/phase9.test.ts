/**
 * Phase 9 — the loops that stopped one step short.
 *
 * Each of these was a real gap found by walking the processes end to end: an
 * officer who could accept a crew's work and then had no way to close the
 * request; a closed request whose jobs stayed live on the street; a resident who
 * was never told they were being asked; public writes with no limit at all.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import express, { type NextFunction, type Request, type Response } from 'express'
import request from 'supertest'
import sharp from 'sharp'
import { Channel, ProofOutcome, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { rateLimit, resetRateLimits } from '../src/middleware/rateLimit.js'
import { sweepSilentCitizens } from '../src/services/proof.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const HOUR = 3_600_000

let f: Fixture
let officer: number
let otherOfficer: number
let supervisor: number
let counter = 0

const bearer = (id: number, role: Role) => `Bearer ${signToken(id, 'access', role)}`

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

async function liveRequest(citizenId: number | null = null) {
  return prisma.serviceRequest.create({
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
      assignedOfficerId: officer,
      isImported: false,
    },
  })
}

async function job(requestId: number) {
  return prisma.workOrder.create({
    data: {
      requestId,
      issuedById: officer,
      code: `P9JB-${String(++counter).padStart(4, '0')}`,
      issuedAt: new Date(Date.now() - HOUR),
      expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
    },
  })
}

beforeEach(async () => {
  await reset()
  f = await build()
  officer = await staff('DOT Officer BK-01', Role.OFFICER, f.board1)
  otherOfficer = await staff('DOT Officer BK-02', Role.OFFICER, f.board2)
  supervisor = await staff('DOT Supervisor', Role.SUPERVISOR, f.borough)
})

describe('the officer closes what they answer for', () => {
  it('closes a request, recorded like any other status change', async () => {
    const r = await liveRequest()
    const res = await request(app)
      .patch(`${api}/officer/requests/${r.id}/status`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ status: 'CLOSED', note: 'Resurfaced and inspected.' })
      .expect(200)
    expect(res.body.status).toBe('CLOSED')

    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })
    expect(stored.closedAt).not.toBeNull()
    expect(stored.resolutionNote).toBe('Resurfaced and inspected.')
    const history = await prisma.requestStatusHistory.findMany({ where: { requestId: r.id } })
    expect(history.at(-1)).toMatchObject({ fromStatus: 'OPEN', toStatus: 'CLOSED', actorId: officer })
    expect(await prisma.auditEvent.count({ where: { action: 'request.status_changed' } })).toBe(1)
  })

  it('refuses an officer the request is not assigned to, and allows the agency’s supervisor', async () => {
    const r = await liveRequest()
    await request(app)
      .patch(`${api}/officer/requests/${r.id}/status`)
      .set('Authorization', bearer(otherOfficer, Role.OFFICER))
      .send({ status: 'CLOSED' })
      .expect(403)
    await request(app)
      .patch(`${api}/officer/requests/${r.id}/status`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ status: 'IN_PROGRESS' })
      .expect(200)
  })

  it('keeps the agent’s route working through the same transition', async () => {
    const r = await liveRequest()
    await request(app)
      .patch(`${api}/requests/${r.id}/status`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .send({ status: 'CLOSED', note: 'Closed by the agency.' })
      .expect(200)
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('CLOSED')
  })
})

describe('closing takes the work off the street', () => {
  it('withdraws jobs still out, and leaves a finished one as it was', async () => {
    const r = await liveRequest()
    const out = await job(r.id)
    const done = await job(r.id)
    await prisma.workOrder.update({ where: { id: done.id }, data: { completedAt: new Date() } })

    await request(app)
      .patch(`${api}/officer/requests/${r.id}/status`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ status: 'CLOSED' })
      .expect(200)

    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: out.id } })).cancelledAt).not.toBeNull()
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: done.id } })).cancelledAt).toBeNull()
    const withdrawn = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'work_order.withdrawn_on_close' } })
    expect(withdrawn.payload).toMatchObject({ codes: [out.code] })
  })

  it('refuses a crew report on a closed request, with or without photographs', async () => {
    const r = await liveRequest()
    const out = await job(r.id)
    await prisma.serviceRequest.update({ where: { id: r.id }, data: { status: RequestStatus.CLOSED } })

    const plain = await request(app).post(`${api}/work-orders/${out.code}/complete`).send({}).expect(400)
    expect(plain.body.error ?? plain.body.message).toMatch(/already been closed/)

    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#777' } }).jpeg().toBuffer()
    const multipart = await request(app)
      .post(`${api}/work-orders/${out.code}/complete`)
      .attach('photos', photo, 'done.jpg')
      .expect(400)
    expect(multipart.body.error ?? multipart.body.message).toMatch(/already been closed/)

    const open = await request(app).get(`${api}/work-orders/${out.code}`).expect(200)
    expect(open.body.requestClosed).toBe(true)
  })
})

describe('what is waiting on the resident', () => {
  it('lists open requests the resident is being asked about, and forgets them once closed', async () => {
    const r = await liveRequest(f.citizen)
    const done = await job(r.id)
    await prisma.workProof.create({
      data: { workOrderId: done.id, score: 80, checks: [], outcome: ProofOutcome.NEEDS_CITIZEN },
    })

    const before = await request(app)
      .get(`${api}/proof/waiting`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .expect(200)
    expect(before.body.rows.map((row: { srNumber: string }) => row.srNumber)).toEqual([r.srNumber])

    // Someone who did not report it is asked nothing.
    const other = await request(app)
      .get(`${api}/proof/waiting`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .expect(200)
    expect(other.body.rows).toEqual([])

    await prisma.serviceRequest.update({ where: { id: r.id }, data: { status: RequestStatus.CLOSED } })
    const after = await request(app)
      .get(`${api}/proof/waiting`)
      .set('Authorization', bearer(f.citizen, Role.CITIZEN))
      .expect(200)
    expect(after.body.rows).toEqual([])

    // Nor does the silent-resident sweep decide a question that no longer stands.
    const later = new Date(Date.now() + (env.CITIZEN_GRACE_HOURS + 1) * HOUR)
    expect((await sweepSilentCitizens(prisma, later)).considered).toBe(0)
  })
})

describe('the shared rate limit', () => {
  it('refuses past its budget, says when to come back, and shares a budget by name', async () => {
    resetRateLimits()
    const tiny = express()
    const limit = () =>
      rateLimit({ bucket: 'phase9-test', windowMs: 60_000, max: 2, message: 'Slow down', enforceInTest: true })
    tiny.get('/a', limit(), (_req, res) => res.json({ ok: true }))
    tiny.get('/b', limit(), (_req, res) => res.json({ ok: true }))
    tiny.use((err: { status?: number; message: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.status ?? 500).json({ error: err.message })
    })

    await request(tiny).get('/a').expect(200)
    await request(tiny).get('/b').expect(200)
    // Two routes, one budget: the third request is refused whichever route it hits.
    const refused = await request(tiny).get('/a').expect(429)
    expect(refused.body.error).toBe('Slow down')
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
  })
})
