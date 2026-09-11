/**
 * Layer 2 — escalation — and the gate the plan set for it: the automatic trigger
 * fires on breach and only on breach.
 *
 * Three ways that goes wrong, each tested. It fires early — at the deadline
 * rather than after it, or at the second rung before twice the service level.
 * It fires on the wrong requests — the untouched imported rows, every open one of
 * which is past due at the snapshot and would all escalate at once (I6). Or it
 * fires twice — two sweeps overlapping and doubling a rung.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Channel, EscalationTrigger, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { levelDue, sweep } from '../src/services/escalation.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const HOUR = 3_600_000

let f: Fixture
let officer: number
let otherOfficer: number
let supervisor: number
let commissioner: number
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

/** A request with a 10-hour service level, filed `ageHours` ago. */
async function live(ageHours: number, extra: Partial<{ isImported: boolean; status: RequestStatus }> = {}) {
  const now = Date.now()
  const createdAt = new Date(now - ageHours * HOUR)
  return prisma.serviceRequest.create({
    data: {
      srNumber: `DG-2026-${String(++counter).padStart(6, '0')}`,
      typeId: f.streetType,
      agencyId: f.dot,
      orgUnitId: f.board1,
      status: extra.status ?? RequestStatus.OPEN,
      channel: Channel.ONLINE,
      createdAt,
      slaDueAt: new Date(createdAt.getTime() + 10 * HOUR),
      assignedOfficerId: officer,
      isImported: extra.isImported ?? false,
    },
  })
}

beforeEach(async () => {
  await reset()
  f = await build()
  officer = await staff('DOT Officer BK-01', Role.OFFICER, f.board1)
  otherOfficer = await staff('DOT Officer BK-02', Role.OFFICER, f.board2)
  supervisor = await staff('DOT Supervisor', Role.SUPERVISOR, f.borough)
  commissioner = await staff('DOT Borough Commissioner', Role.COMMISSIONER, f.borough)
})

describe('the rung a request is due', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z')
  const slaDueAt = new Date('2026-01-01T10:00:00Z')

  it('is 0 at the deadline itself — breach means after, not at', () => {
    expect(levelDue({ createdAt, slaDueAt }, slaDueAt)).toBe(0)
  })
  it('is 1 the moment after the deadline', () => {
    expect(levelDue({ createdAt, slaDueAt }, new Date(slaDueAt.getTime() + 1))).toBe(1)
  })
  it('is still 1 at exactly twice the service level, and 2 after it', () => {
    const twice = new Date('2026-01-01T20:00:00Z')
    expect(levelDue({ createdAt, slaDueAt }, twice)).toBe(1)
    expect(levelDue({ createdAt, slaDueAt }, new Date(twice.getTime() + 1))).toBe(2)
  })
})

describe('the automatic trigger', () => {
  it('does nothing to a request that has not reached its deadline', async () => {
    const r = await live(9)
    await sweep(prisma)
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).escalationLevel).toBe(0)
    expect(await prisma.escalation.count()).toBe(0)
  })

  it('takes a breached request to the supervisor, and records why', async () => {
    const r = await live(11)
    await sweep(prisma)

    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })
    expect(stored.escalationLevel).toBe(1)
    // Escalation pulls someone in beside the officer; it does not take the request away.
    expect(stored.assignedOfficerId).toBe(officer)

    const rungs = await prisma.escalation.findMany({ where: { requestId: r.id } })
    expect(rungs).toHaveLength(1)
    expect(rungs[0]).toMatchObject({
      fromLevel: 0,
      toLevel: 1,
      trigger: EscalationTrigger.SLA_BREACH,
      toUserId: supervisor,
      raisedById: null,
    })

    const events = await prisma.auditEvent.findMany({ where: { action: 'request.escalated' } })
    expect(events).toHaveLength(1)
    expect(events[0]!.source).toBe('system')
  })

  it('climbs both rungs, each recorded, when found past twice its service level', async () => {
    const r = await live(25)
    await sweep(prisma)
    const rungs = await prisma.escalation.findMany({ where: { requestId: r.id }, orderBy: { toLevel: 'asc' } })
    expect(rungs.map((e) => [e.fromLevel, e.toLevel, e.toUserId])).toEqual([
      [0, 1, supervisor],
      [1, 2, commissioner],
    ])
  })

  it('never doubles a rung, however many times it runs', async () => {
    await live(25)
    await Promise.all([sweep(prisma), sweep(prisma), sweep(prisma)])
    await sweep(prisma)
    expect(await prisma.escalation.count()).toBe(2)
  })

  it('leaves NYC’s untouched history alone, though every row of it is overdue', async () => {
    // Filed in 2022, open, long past its deadline — and never acted on here.
    const imported = await live(24 * 365 * 3, { isImported: true })
    await prisma.requestStatusHistory.create({
      data: { requestId: imported.id, fromStatus: null, toStatus: RequestStatus.OPEN, at: imported.createdAt },
    })
    await sweep(prisma)
    expect(await prisma.escalation.count()).toBe(0)
  })

  it('treats an imported request this system has acted on as live work', async () => {
    const imported = await live(24 * 365 * 3, { isImported: true })
    await prisma.requestStatusHistory.create({
      data: {
        requestId: imported.id,
        fromStatus: RequestStatus.CLOSED,
        toStatus: RequestStatus.OPEN,
        at: new Date(),
        actorId: f.dotAgent,
      },
    })
    await sweep(prisma)
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: imported.id } })).escalationLevel).toBe(2)
  })

  it('ignores closed requests', async () => {
    await live(25, { status: RequestStatus.CLOSED })
    await sweep(prisma)
    expect(await prisma.escalation.count()).toBe(0)
  })

  it('writes no status-history row — an escalation is not one of NYC’s statuses', async () => {
    const r = await live(11)
    await sweep(prisma)
    expect(await prisma.requestStatusHistory.count({ where: { requestId: r.id } })).toBe(0)
  })
})

describe('raising a request by hand', () => {
  it('lets the accountable officer escalate before any breach, with a reason', async () => {
    const r = await live(1)
    const res = await request(app)
      .post(`${api}/requests/${r.id}/escalate`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ reason: 'Contractor has not responded in a week' })
      .expect(200)
    expect(res.body.escalationLevel).toBe(1)
    expect(res.body.escalations[0]).toMatchObject({ trigger: 'MANUAL', toLevelName: 'supervisor' })
  })

  it('refuses an escalation without a real reason', async () => {
    const r = await live(1)
    await request(app)
      .post(`${api}/requests/${r.id}/escalate`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ reason: 'urgent' })
      .expect(422)
  })

  it('refuses an officer who does not answer for the request', async () => {
    const r = await live(1)
    await request(app)
      .post(`${api}/requests/${r.id}/escalate`)
      .set('Authorization', bearer(otherOfficer, Role.OFFICER))
      .send({ reason: 'Contractor has not responded in a week' })
      .expect(403)
  })

  it('lets a supervisor send it on to the commissioner, and no further', async () => {
    const r = await live(1)
    const reason = { reason: 'Needs a capital repair, not a patch' }
    await request(app).post(`${api}/requests/${r.id}/escalate`).set('Authorization', bearer(supervisor, Role.SUPERVISOR)).send(reason).expect(200)
    const second = await request(app).post(`${api}/requests/${r.id}/escalate`).set('Authorization', bearer(supervisor, Role.SUPERVISOR)).send(reason).expect(200)
    expect(second.body.escalations[1].toUser.name).toBe('DOT Borough Commissioner')
    await request(app).post(`${api}/requests/${r.id}/escalate`).set('Authorization', bearer(supervisor, Role.SUPERVISOR)).send(reason).expect(400)
  })
})

describe('the escalation register', () => {
  it('shows supervisors what reached them, and is closed to officers', async () => {
    const r = await live(11)
    await sweep(prisma)
    const res = await request(app)
      .get(`${api}/escalations`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .expect(200)
    expect(res.body.rows.map((row: { srNumber: string }) => row.srNumber)).toEqual([r.srNumber])
    expect(res.body.rows[0].escalationLevelName).toBe('supervisor')

    await request(app).get(`${api}/escalations`).set('Authorization', bearer(officer, Role.OFFICER)).expect(403)
  })

  it('tells the officer whether they can escalate their own request', async () => {
    const r = await live(1)
    const res = await request(app)
      .get(`${api}/escalations/request/${r.srNumber}`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .expect(200)
    expect(res.body).toMatchObject({ escalationLevel: 0, canEscalate: true, nextLevelName: 'supervisor' })
  })
})
