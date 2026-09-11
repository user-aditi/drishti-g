/**
 * Layer 1 — officer identity — and the two lines it must not cross.
 *
 * The first is the gate: every open request has exactly one accountable person.
 * A filing has to leave its transaction already owned, a request with no board
 * still has to land with someone, and a gap in staffing must show up as an
 * unassigned request rather than as a refused report.
 *
 * The second is the baseline. Layer 1 attaches to Layer 0 at one hook and adds
 * nothing to what Layer 0 returns, writes or records — no status-history row for
 * an assignment, no officer field on the public record — because a baseline that
 * has quietly absorbed our concepts can no longer be the control (N5).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { AssignmentSource, Channel, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { referenceDate } from '../src/config/systemClock.js'
import { signToken } from '../src/lib/auth.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX

let f: Fixture
let officer1: number
let officer1b: number
let dutyOfficer: number
let supervisor: number
let dsnySupervisor: number

const bearer = (id: number, role: Role) => `Bearer ${signToken(id, 'access', role)}`

async function staff(email: string, name: string, role: Role, agencyId: number, unitId: number) {
  const user = await prisma.user.create({
    data: { email, name, passwordHash: 'x', role, agencyId, isSynthetic: true },
  })
  await prisma.posting.create({ data: { userId: user.id, agencyId, orgUnitId: unitId } })
  return user.id
}

beforeEach(async () => {
  await reset()
  f = await build()
  officer1 = await staff('o1@example.invalid', 'DOT Officer · BK-01', Role.OFFICER, f.dot, f.board1)
  dutyOfficer = await staff('duty@example.invalid', 'DOT Duty Officer · Brooklyn', Role.OFFICER, f.dot, f.borough)
  supervisor = await staff('sup@example.invalid', 'DOT Supervisor · Brooklyn', Role.SUPERVISOR, f.dot, f.borough)
  dsnySupervisor = await staff('dsup@example.invalid', 'DSNY Supervisor · Brooklyn', Role.SUPERVISOR, f.dsny, f.borough)
  officer1b = 0
})

describe('the posting rule, at filing time', () => {
  it('assigns a new request to its board’s officer inside the filing transaction', async () => {
    const res = await request(app)
      .post(`${api}/requests`)
      .send({ typeId: f.streetType, orgUnitId: f.board1 })
      .expect(201)

    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(stored.assignedOfficerId).toBe(officer1)
    expect(stored.assignedAt).not.toBeNull()

    const assignments = await prisma.assignment.findMany({ where: { requestId: res.body.id } })
    expect(assignments).toHaveLength(1)
    expect(assignments[0]!.source).toBe(AssignmentSource.POSTING_RULE)
    expect(assignments[0]!.assignedById).toBeNull()

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'request', entityId: String(res.body.id) },
      orderBy: { id: 'asc' },
    })
    expect(events.map((e) => e.action)).toEqual(['request.filed', 'request.assigned'])
  })

  it('writes no status-history row for an assignment', async () => {
    // Status history feeds the process-mining event log. An assignment is not a
    // status change, and recording it as one would give NYC's lifecycle a step
    // it never had.
    const res = await request(app)
      .post(`${api}/requests`)
      .send({ typeId: f.streetType, orgUnitId: f.board1 })
      .expect(201)
    const history = await prisma.requestStatusHistory.findMany({ where: { requestId: res.body.id } })
    expect(history).toHaveLength(1)
  })

  it('sends a request with no board to the agency’s borough duty officer', async () => {
    const res = await request(app).post(`${api}/requests`).send({ typeId: f.streetType }).expect(201)
    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(stored.assignedOfficerId).toBe(dutyOfficer)
  })

  it('files the request anyway when nobody is posted, and leaves it visibly unassigned', async () => {
    // No DSNY officer exists in this fixture. A citizen's report must never be
    // refused because of a gap in our staffing.
    const res = await request(app)
      .post(`${api}/requests`)
      .send({ typeId: f.sanitationType, orgUnitId: f.board1 })
      .expect(201)
    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(stored.assignedOfficerId).toBeNull()

    const queue = await request(app)
      .get(`${api}/supervisor/unassigned`)
      .set('Authorization', bearer(dsnySupervisor, Role.SUPERVISOR))
      .expect(200)
    expect(queue.body.rows.map((r: { srNumber: string }) => r.srNumber)).toEqual([res.body.srNumber])
  })

  it('balances load between two officers on the same board', async () => {
    officer1b = await staff('o1b@example.invalid', 'DOT Officer · BK-01 (2)', Role.OFFICER, f.dot, f.board1)
    const first = await request(app).post(`${api}/requests`).send({ typeId: f.streetType, orgUnitId: f.board1 })
    const second = await request(app).post(`${api}/requests`).send({ typeId: f.streetType, orgUnitId: f.board1 })
    const owners = await prisma.serviceRequest.findMany({
      where: { id: { in: [first.body.id, second.body.id] } },
      select: { assignedOfficerId: true },
    })
    expect(new Set(owners.map((o) => o.assignedOfficerId))).toEqual(new Set([officer1, officer1b]))
  })
})

describe('the baseline stays the baseline', () => {
  it('adds nothing to the Layer 0 record a citizen sees', async () => {
    const res = await request(app)
      .post(`${api}/requests`)
      .send({ typeId: f.streetType, orgUnitId: f.board1 })
      .expect(201)
    const lookup = await request(app).get(`${api}/requests/${res.body.srNumber}`).expect(200)
    expect(lookup.body).not.toHaveProperty('accountable')
    expect(lookup.body).not.toHaveProperty('assignedOfficerId')
    expect(lookup.body).not.toHaveProperty('workOrders')
  })
})

describe('the officer’s desk', () => {
  it('lists the officer’s own open requests and nobody else’s', async () => {
    await request(app).post(`${api}/requests`).send({ typeId: f.streetType, orgUnitId: f.board1 })
    await request(app).post(`${api}/requests`).send({ typeId: f.streetType })

    const desk = await request(app)
      .get(`${api}/officer/desk`)
      .set('Authorization', bearer(officer1, Role.OFFICER))
      .expect(200)
    expect(desk.body.total).toBe(1)
    expect(desk.body.rows[0].accountable).toMatchObject({ id: officer1, isSynthetic: true })
  })

  it('refuses an officer another officer’s request', async () => {
    const filed = await request(app).post(`${api}/requests`).send({ typeId: f.streetType })
    await request(app)
      .get(`${api}/officer/requests/${filed.body.srNumber}`)
      .set('Authorization', bearer(officer1, Role.OFFICER))
      .expect(403)
  })

  it('is not open to agents', async () => {
    await request(app)
      .get(`${api}/officer/desk`)
      .set('Authorization', bearer(f.dotAgent, Role.AGENT))
      .expect(403)
  })
})

describe('assignment by a supervisor', () => {
  let requestId: number

  beforeEach(async () => {
    const filed = await request(app).post(`${api}/requests`).send({ typeId: f.streetType, orgUnitId: f.board1 })
    requestId = filed.body.id
  })

  it('reassigns within the agency and records who decided', async () => {
    const res = await request(app)
      .post(`${api}/requests/${requestId}/assign`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ officerId: dutyOfficer })
      .expect(200)
    expect(res.body.accountable.id).toBe(dutyOfficer)

    const log = await prisma.assignment.findMany({ where: { requestId }, orderBy: { id: 'asc' } })
    expect(log.map((a) => a.source)).toEqual([AssignmentSource.POSTING_RULE, AssignmentSource.SUPERVISOR])
    expect(log[1]!.assignedById).toBe(supervisor)
  })

  it('refuses a supervisor from another agency', async () => {
    await request(app)
      .post(`${api}/requests/${requestId}/assign`)
      .set('Authorization', bearer(dsnySupervisor, Role.SUPERVISOR))
      .send({ officerId: dutyOfficer })
      .expect(403)
  })

  it('refuses an officer who is not posted to the request’s board or borough', async () => {
    const elsewhere = await staff('o2@example.invalid', 'DOT Officer · BK-02', Role.OFFICER, f.dot, f.board2)
    await request(app)
      .post(`${api}/requests/${requestId}/assign`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ officerId: elsewhere })
      .expect(400)
  })

  it('refuses to assign a closed request', async () => {
    await prisma.serviceRequest.update({ where: { id: requestId }, data: { status: RequestStatus.CLOSED } })
    await request(app)
      .post(`${api}/requests/${requestId}/assign`)
      .set('Authorization', bearer(supervisor, Role.SUPERVISOR))
      .send({ officerId: dutyOfficer })
      .expect(400)
  })
})

describe('work orders', () => {
  let requestId: number
  let srNumber: string

  beforeEach(async () => {
    const filed = await request(app).post(`${api}/requests`).send({ typeId: f.streetType, orgUnitId: f.board1 })
    requestId = filed.body.id
    srNumber = filed.body.srNumber
  })

  async function issue() {
    const res = await request(app)
      .post(`${api}/work-orders`)
      .set('Authorization', bearer(officer1, Role.OFFICER))
      .send({ requestId, instructions: 'Fill and seal.' })
      .expect(201)
    return res.body as { code: string; link: string; qrDataUrl: string }
  }

  it('returns a scannable QR with the order, and shows it again only to its issuer', async () => {
    const order = await issue()
    expect(order.qrDataUrl).toMatch(/^data:image\/png;base64,/)

    const again = await request(app)
      .get(`${api}/work-orders/${order.code}/qr`)
      .set('Authorization', bearer(officer1, Role.OFFICER))
      .expect(200)
    expect(again.body.qrDataUrl).toMatch(/^data:image\/png;base64,/)

    // Another officer gets the same answer as for a code that does not exist.
    await request(app)
      .get(`${api}/work-orders/${order.code}/qr`)
      .set('Authorization', bearer(dutyOfficer, Role.OFFICER))
      .expect(404)
  })

  it('can only be issued by the officer who answers for the request', async () => {
    await request(app)
      .post(`${api}/work-orders`)
      .set('Authorization', bearer(dutyOfficer, Role.OFFICER))
      .send({ requestId })
      .expect(403)
  })

  it('issues an unambiguous code and a link a crew can open', async () => {
    const order = await issue()
    expect(order.code).toMatch(/^[ACDEFGHJKMNPQRTUVWXY2346789]{4}-[ACDEFGHJKMNPQRTUVWXY2346789]{4}$/)
    expect(order.link).toMatch(new RegExp(`/w/${order.code}$`))
  })

  it('shows a crew the job, and not who reported it', async () => {
    const order = await issue()
    // Typed the way people type codes: lower case, no dash.
    const res = await request(app)
      .get(`${api}/work-orders/${order.code.replace('-', '').toLowerCase()}`)
      .expect(200)
    expect(res.body.job.srNumber).toBe(srNumber)
    expect(res.body.instructions).toBe('Fill and seal.')
    expect(res.body.issuedBy.isSynthetic).toBe(true)
    expect(JSON.stringify(res.body)).not.toMatch(/citizen|email|phone/i)
  })

  it('records the crew’s report without closing the request', async () => {
    // "The crew says it is done" and "it is done" are different claims; closing
    // stays the officer's act, and verifying it is Layer 4's.
    const order = await issue()
    await request(app).post(`${api}/work-orders/${order.code}/complete`).send({ note: 'Done.' }).expect(200)

    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { code: order.code } })
    expect(stored.completedAt).not.toBeNull()
    const req = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })
    expect(req.status).toBe(RequestStatus.OPEN)

    await request(app).post(`${api}/work-orders/${order.code}/complete`).expect(400)
  })

  it('refuses an expired code', async () => {
    const order = await issue()
    await prisma.workOrder.update({
      where: { code: order.code },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await request(app).post(`${api}/work-orders/${order.code}/complete`).expect(400)
  })

  it('refuses a code that matches no job', async () => {
    await request(app).get(`${api}/work-orders/ZZZZ-ZZZZ`).expect(404)
  })
})

describe('time', () => {
  it('stamps an assignment in real time, not at the snapshot the record was observed at', async () => {
    // An assignment is an event in this system. The reference date governs what
    // NYC's record says; it does not rewind when this system acts.
    const before = Date.now()
    const res = await request(app).post(`${api}/requests`).send({ typeId: f.streetType, orgUnitId: f.board1 })
    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(stored.assignedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(stored.assignedAt!.getTime()).not.toBe(referenceDate().getTime())
    expect(Channel.ONLINE).toBe('ONLINE')
  })
})
