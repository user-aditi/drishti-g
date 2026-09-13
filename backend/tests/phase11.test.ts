/**
 * Phase 11 — every role has its tools.
 *
 * The senior people escalations reach can say they have them; a closed request
 * resolves its escalations; the board rollup and map are public, filtered by
 * agency rather than scoped by who asks; and the administrator can move people,
 * deactivate them, and see the state of the running system — without ever
 * leaving an open request answered for by someone who can no longer act on it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Channel, EscalationTrigger, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { invalidateBoards } from '../src/routes/boards.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const HOUR = 3_600_000

let f: Fixture
let officer: number
let otherOfficer: number
let supervisor: number
let commissioner: number
let dsnySupervisor: number
let admin: number
let counter = 0

const bearer = (id: number, role: Role) => `Bearer ${signToken(id, 'access', role)}`

async function staff(name: string, role: Role, agencyId: number | null, unitId: number | null) {
  const user = await prisma.user.create({
    data: {
      email: `${name.replace(/\W+/g, '.').toLowerCase()}@example.invalid`,
      name,
      passwordHash: 'x',
      role,
      agencyId,
      isSynthetic: true,
    },
  })
  if (agencyId !== null && unitId !== null) {
    await prisma.posting.create({ data: { userId: user.id, agencyId, orgUnitId: unitId } })
  }
  return user.id
}

async function liveRequest(opts: { board?: number; officerId?: number | null } = {}) {
  return prisma.serviceRequest.create({
    data: {
      srNumber: `DG-2026-${String(++counter).padStart(6, '0')}`,
      typeId: f.streetType,
      agencyId: f.dot,
      orgUnitId: opts.board ?? f.board1,
      status: RequestStatus.OPEN,
      channel: Channel.ONLINE,
      createdAt: new Date(Date.now() - 2 * HOUR),
      slaDueAt: new Date(Date.now() + 48 * HOUR),
      assignedOfficerId: opts.officerId === undefined ? officer : opts.officerId,
      isImported: false,
    },
  })
}

/** An escalated request, at the rung given, as the ladder would have left it. */
async function escalated(level: 1 | 2) {
  const r = await liveRequest()
  for (let rung = 1; rung <= level; rung++) {
    await prisma.escalation.create({
      data: {
        requestId: r.id,
        fromLevel: rung - 1,
        toLevel: rung,
        trigger: EscalationTrigger.SLA_BREACH,
        reason: 'Past its derived deadline',
        toUserId: rung === 1 ? supervisor : commissioner,
        at: new Date(Date.now() - HOUR),
      },
    })
  }
  await prisma.serviceRequest.update({ where: { id: r.id }, data: { escalationLevel: level } })
  const rungs = await prisma.escalation.findMany({ where: { requestId: r.id }, orderBy: { toLevel: 'asc' } })
  return { request: r, rungs }
}

beforeEach(async () => {
  await reset()
  f = await build()
  officer = await staff('DOT Officer BK-01', Role.OFFICER, f.dot, f.board1)
  otherOfficer = await staff('DOT Officer BK-01 second', Role.OFFICER, f.dot, f.board1)
  supervisor = await staff('DOT Supervisor', Role.SUPERVISOR, f.dot, f.borough)
  commissioner = await staff('DOT Commissioner', Role.COMMISSIONER, f.dot, f.borough)
  dsnySupervisor = await staff('DSNY Supervisor', Role.SUPERVISOR, f.dsny, f.borough)
  admin = await staff('Administrator', Role.ADMIN, null, null)
})

describe('acknowledging an escalation', () => {
  it('lets the supervisor acknowledge the rung that reached them, once, on the chain', async () => {
    const { request: r, rungs } = await escalated(1)

    const register = await request(app)
      .get(`${api}/escalations`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .expect(200)
    expect(register.body.rows[0].acknowledgeable).toEqual([rungs[0]!.id])

    const res = await request(app)
      .post(`${api}/escalations/${rungs[0]!.id}/acknowledge`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ note: 'Sending a resurfacing crew on Monday.' })
      .expect(200)
    expect(res.body.escalations[0]).toMatchObject({
      acknowledgeNote: 'Sending a resurfacing crew on Monday.',
      acknowledgedBy: { name: 'DOT Supervisor' },
    })
    expect(res.body.acknowledgeable).toEqual([])

    await request(app)
      .post(`${api}/escalations/${rungs[0]!.id}/acknowledge`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ note: 'Acknowledging a second time.' })
      .expect(400)

    const events = await prisma.auditEvent.findMany({ where: { action: 'escalation.acknowledged' } })
    expect(events).toHaveLength(1)
    expect(events[0]!.entityId).toBe(String(r.id))
  })

  it('refuses anyone who does not hold that rung in that agency', async () => {
    const { rungs } = await escalated(2)
    const [toSupervisor, toCommissioner] = rungs
    const note = { note: 'I will look at this today.' }

    // The rung below cannot close off the rung above, nor the other way round.
    await request(app)
      .post(`${api}/escalations/${toCommissioner!.id}/acknowledge`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send(note)
      .expect(403)
    await request(app)
      .post(`${api}/escalations/${toSupervisor!.id}/acknowledge`)
      .set('Authorization', bearer(commissioner, Role.COMMISSIONER))
      .send(note)
      .expect(403)
    // Another agency's supervisor, and the officer.
    await request(app)
      .post(`${api}/escalations/${toSupervisor!.id}/acknowledge`)
      .set('Authorization', bearer(dsnySupervisor, Role.SUPERVISOR))
      .send(note)
      .expect(403)
    await request(app)
      .post(`${api}/escalations/${toSupervisor!.id}/acknowledge`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send(note)
      .expect(403)

    await request(app)
      .post(`${api}/escalations/${toCommissioner!.id}/acknowledge`)
      .set('Authorization', bearer(commissioner, Role.COMMISSIONER))
      .send(note)
      .expect(200)
  })

  it('needs a note, and refuses a closed request', async () => {
    const { request: r, rungs } = await escalated(1)
    await request(app)
      .post(`${api}/escalations/${rungs[0]!.id}/acknowledge`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ note: 'ok' })
      .expect(422)

    await prisma.serviceRequest.update({ where: { id: r.id }, data: { status: RequestStatus.CLOSED } })
    await request(app)
      .post(`${api}/escalations/${rungs[0]!.id}/acknowledge`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ note: 'Too late for this one.' })
      .expect(400)
  })
})

describe('a closed request resolves its escalations', () => {
  it('stamps every rung when it closes, and clears them if it is reopened', async () => {
    const { request: r } = await escalated(2)

    await request(app)
      .patch(`${api}/officer/requests/${r.id}/status`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .send({ status: 'CLOSED', note: 'Resurfaced.' })
      .expect(200)
    let rungs = await prisma.escalation.findMany({ where: { requestId: r.id } })
    expect(rungs.every((rung) => rung.resolvedAt !== null)).toBe(true)

    await request(app)
      .patch(`${api}/requests/${r.id}/status`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .send({ status: 'OPEN', note: 'The patch has failed again.' })
      .expect(200)
    rungs = await prisma.escalation.findMany({ where: { requestId: r.id } })
    expect(rungs.every((rung) => rung.resolvedAt === null)).toBe(true)
  })
})

describe('the board rollup and map are public', () => {
  beforeEach(async () => {
    await prisma.serviceRequest.createMany({
      data: [
        { agencyId: f.dot, typeId: f.streetType },
        { agencyId: f.dot, typeId: f.streetType },
        { agencyId: f.dsny, typeId: f.sanitationType },
      ].map((row, i) => ({
        ...row,
        srNumber: `NYC-9${i}`,
        orgUnitId: f.board1,
        status: RequestStatus.OPEN,
        channel: Channel.PHONE,
        createdAt: new Date(),
        latitude: 40.6782,
        longitude: -73.9442,
        isImported: true,
      })),
    })
    invalidateBoards()
  })

  it('answers without a session, for every agency or one', async () => {
    const all = await request(app).get(`${api}/boards`).expect(200)
    const dot = await request(app).get(`${api}/boards?agencyId=${f.dot}`).expect(200)
    const dsny = await request(app).get(`${api}/boards?agencyId=${f.dsny}`).expect(200)
    const board = (body: { code: string; total: number }[]) => body.find((b) => b.code === 'BK-01')!.total

    expect(board(all.body)).toBe(3)
    expect(board(dot.body)).toBe(2)
    expect(board(dsny.body)).toBe(1)
    // Cached per filter, so asking for one agency never serves another's figures.
    expect(board((await request(app).get(`${api}/boards`).expect(200)).body)).toBe(3)
  })

  it('clusters the map without a session, filtered by the agency asked for', async () => {
    const bbox = 'bbox=-74.1,40.5,-73.8,40.8&zoom=10'
    const count = (body: { count: number }[]) => body.reduce((n, c) => n + c.count, 0)
    expect(count((await request(app).get(`${api}/map/clusters?${bbox}`).expect(200)).body)).toBe(3)
    expect(
      count((await request(app).get(`${api}/map/clusters?${bbox}&agencyId=${f.dsny}`).expect(200)).body),
    ).toBe(1)
  })
})

describe('the administrator’s people register', () => {
  it('lists staff with their posts and open work, never residents, and only for the administrator', async () => {
    await liveRequest()
    const res = await request(app)
      .get(`${api}/admin/people`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)
    expect(res.body.rows.some((row: { role: string }) => row.role === 'CITIZEN')).toBe(false)
    const row = res.body.rows.find((r: { id: number }) => r.id === officer)
    expect(row).toMatchObject({ openAssigned: 1, posted: true })
    expect(row.postings[0].orgUnit.code).toBe('BK-01')

    await request(app)
      .get(`${api}/admin/people`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .expect(403)
    await request(app)
      .get(`${api}/admin/people?role=CITIZEN`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(400)
  })

  it('moves an officer and hands their open requests to whoever holds the old board', async () => {
    const r = await liveRequest()
    await request(app)
      .post(`${api}/admin/people/${officer}/posting`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ agencyId: f.dot, orgUnitId: f.board2, reason: 'Covering BK-02 this quarter.' })
      .expect(200)

    const postings = await prisma.posting.findMany({ where: { userId: officer }, orderBy: { id: 'asc' } })
    expect(postings.map((p) => [p.orgUnitId, p.endedAt === null])).toEqual([
      [f.board1, false],
      [f.board2, true],
    ])
    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })
    expect(stored.assignedOfficerId).toBe(otherOfficer)
    const moved = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'user.posting_moved' } })
    expect(moved.payload).toMatchObject({ requests: { kept: 0, reassigned: 1, unassigned: 0 } })
  })

  it('leaves a request unassigned, visibly, when nobody is left to take it', async () => {
    await prisma.user.update({ where: { id: otherOfficer }, data: { isActive: false } })
    const r = await liveRequest()
    await request(app)
      .post(`${api}/admin/people/${officer}/posting`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ agencyId: f.dot, orgUnitId: f.board2, reason: 'Covering BK-02 this quarter.' })
      .expect(200)
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).assignedOfficerId).toBeNull()
    expect(await prisma.auditEvent.count({ where: { action: 'request.unassigned' } })).toBe(1)
  })

  it('moves a supervisor to another agency, and refuses to post an agent', async () => {
    await request(app)
      .post(`${api}/admin/people/${supervisor}/posting`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ agencyId: f.dsny, orgUnitId: f.borough, reason: 'Transferred to Sanitation.' })
      .expect(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: supervisor } })).agencyId).toBe(f.dsny)

    await request(app)
      .post(`${api}/admin/people/${f.dotAgent}/posting`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ agencyId: f.dot, orgUnitId: f.board2, reason: 'Agents are not posted.' })
      .expect(400)
  })

  it('deactivates an officer: their session stops working and their work is handed on', async () => {
    const r = await liveRequest()
    await request(app)
      .post(`${api}/admin/people/${officer}/active`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ active: false, reason: 'Left the department.' })
      .expect(200)

    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).assignedOfficerId).toBe(
      otherOfficer,
    )
    await request(app)
      .get(`${api}/officer/desk`)
      .set('Authorization', bearer(officer, Role.OFFICER))
      .expect(403)

    await request(app)
      .post(`${api}/admin/people/${officer}/active`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ active: true, reason: 'Returned from leave.' })
      .expect(200)
    // The account comes back; the request stays with the officer who took it on.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: officer } })).isActive).toBe(true)
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).assignedOfficerId).toBe(
      otherOfficer,
    )
    expect(await prisma.auditEvent.count({ where: { action: { in: ['user.deactivated', 'user.reactivated'] } } })).toBe(2)
  })

  it('shows one person’s posts, current and ended, with what the chain says about them', async () => {
    await request(app)
      .post(`${api}/admin/people/${officer}/posting`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ agencyId: f.dot, orgUnitId: f.board2, reason: 'Covering BK-02 this quarter.' })
      .expect(200)
    const res = await request(app)
      .get(`${api}/admin/people/${officer}`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)
    expect(res.body.person.postings.map((p: { endedAt: string | null }) => p.endedAt === null)).toEqual([true, false])
    expect(res.body.history[0].action).toBe('user.posting_moved')
    await request(app)
      .get(`${api}/admin/people/${f.citizen}`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(404)
  })

  it('will not let the administrator lock themselves out', async () => {
    await request(app)
      .post(`${api}/admin/people/${admin}/active`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .send({ active: false, reason: 'Testing the guard.' })
      .expect(400)
  })
})

describe('the system page', () => {
  it('reports the clock, the models this build declares, the chain and the people', async () => {
    const res = await request(app)
      .get(`${api}/admin/system`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)

    expect(res.body.status).toBe('ok')
    expect(res.body.clock.referenceDate).toBeTruthy()
    expect(res.body.specs.map((s: { file: string }) => s.file).sort()).toEqual(
      ['gcce-spec.json', 'grie-spec.json', 'proof-spec.json'],
    )
    expect(Array.isArray(res.body.jobs)).toBe(true)
    expect(res.body.chain.length).toBe(0)
    expect(res.body.people.byRole.find((r: { role: string }) => r.role === 'OFFICER')).toMatchObject({ active: 2 })

    await request(app)
      .get(`${api}/admin/system`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .expect(403)
  })
})
