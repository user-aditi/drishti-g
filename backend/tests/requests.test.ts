/**
 * Layer 0's request lifecycle, and the two things about it that are easy to get
 * quietly wrong.
 *
 * The first is time. This system runs on real historical data and evaluates
 * "overdue" against a configured reference date; the same code asked of
 * `Date.now()` reports every one of 355,430 imported requests as overdue and
 * looks, from the outside, exactly like a working feature. That is F-04, and it
 * has already shipped once in the opposite direction — 2,554 open complaints and
 * zero overdue.
 *
 * The second is the audit boundary. An imported request is a record of something
 * New York did; a filed one is a record of something this system did. If those
 * two populations ever blur, every delta a later layer claims to measure against
 * the baseline is measuring itself.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Channel, RequestStatus } from '@prisma/client'
import { createApp } from '../src/app.js'
import { referenceDate } from '../src/config/systemClock.js'
import { signToken } from '../src/lib/auth.js'
import { env } from '../src/config/env.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX

let f: Fixture

beforeEach(async () => {
  await reset()
  f = await build()
})

function as(userId: number, role: 'AGENT' | 'CITIZEN') {
  return `Bearer ${signToken(userId, 'access', role)}`
}

describe('filing a request', () => {
  it('routes to the type’s agency and sets the deadline from its derived SLA', async () => {
    const res = await request(app)
      .post(`${api}/requests`)
      .send({ typeId: f.streetType, descriptorId: f.streetDescriptor, orgUnitId: f.board1 })
      .expect(201)

    expect(res.body.agency.code).toBe('DOT')
    expect(res.body.srNumber).toMatch(/^DG-\d{4}-\d{6}$/)

    // 110.3 hours after filing, to the millisecond.
    const filed = new Date(res.body.createdAt).getTime()
    const due = new Date(res.body.slaDueAt).getTime()
    expect(due - filed).toBeCloseTo(110.3 * 3_600_000, -2)
  })

  it('is filed by anyone, with no account', async () => {
    // NYC 311 takes reports by telephone from people who have never signed in.
    // A replica that demanded a login before accepting a pothole report would
    // not be a replica.
    await request(app).post(`${api}/requests`).send({ typeId: f.streetType }).expect(201)
  })

  it('marks what this system created as ours, not New York’s', async () => {
    const res = await request(app).post(`${api}/requests`).send({ typeId: f.streetType }).expect(201)
    expect(res.body.isImported).toBe(false)
  })

  it('refuses a descriptor belonging to a different type', async () => {
    // The taxonomy is two levels and the second one is not free-form; a Pothole
    // filed under Missed Collection would corrupt every per-type figure.
    await request(app)
      .post(`${api}/requests`)
      .send({ typeId: f.sanitationType, descriptorId: f.streetDescriptor })
      .expect(400)
  })

  it('writes one history row and one audit entry', async () => {
    const res = await request(app).post(`${api}/requests`).send({ typeId: f.streetType }).expect(201)

    const history = await prisma.requestStatusHistory.findMany({ where: { requestId: res.body.id } })
    expect(history).toHaveLength(1)
    expect(history[0]!.fromStatus).toBeNull()
    expect(history[0]!.toStatus).toBe(RequestStatus.OPEN)

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'request', entityId: String(res.body.id) },
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.action).toBe('request.filed')
  })
})

describe('overdue', () => {
  /**
   * The regression that matters most on this corpus.
   *
   * Both requests below are years past their deadline in wall-clock terms. Only
   * the one that is past it *at the reference date* may be reported overdue.
   */
  it('is judged against the reference date, not the wall clock', async () => {
    const now = referenceDate()
    const past = await prisma.serviceRequest.create({
      data: {
        srNumber: 'NYC-1',
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: RequestStatus.OPEN,
        channel: Channel.PHONE,
        createdAt: new Date(now.getTime() - 30 * 86_400_000),
        slaDueAt: new Date(now.getTime() - 86_400_000),
        isImported: true,
      },
    })
    const future = await prisma.serviceRequest.create({
      data: {
        srNumber: 'NYC-2',
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: RequestStatus.OPEN,
        channel: Channel.PHONE,
        createdAt: new Date(now.getTime() - 86_400_000),
        // Due tomorrow as the system stands, but long past by the wall clock.
        slaDueAt: new Date(now.getTime() + 86_400_000),
        isImported: true,
      },
    })

    const overdue = await request(app)
      .get(`${api}/requests/${past.srNumber}`)
      .expect(200)
    const notYet = await request(app)
      .get(`${api}/requests/${future.srNumber}`)
      .expect(200)

    expect(overdue.body.isOverdue).toBe(true)
    expect(notYet.body.isOverdue).toBe(false)
    // If this ever fails, something started asking Date.now().
    expect(new Date(notYet.body.slaDueAt).getTime()).toBeLessThan(Date.now())
  })

  it('judges a closed request against when it actually closed', async () => {
    const now = referenceDate()
    // Closed *before* its deadline, but only after the reference date has moved
    // well past both. A closed request's punctuality is settled history.
    await prisma.serviceRequest.create({
      data: {
        srNumber: 'NYC-3',
        typeId: f.streetType,
        agencyId: f.dot,
        status: RequestStatus.CLOSED,
        channel: Channel.ONLINE,
        createdAt: new Date(now.getTime() - 30 * 86_400_000),
        slaDueAt: new Date(now.getTime() - 20 * 86_400_000),
        closedAt: new Date(now.getTime() - 25 * 86_400_000),
        isImported: true,
      },
    })
    const res = await request(app).get(`${api}/requests/NYC-3`).expect(200)
    expect(res.body.isOverdue).toBe(false)
  })
})

describe('public lookup', () => {
  it('resolves an imported SR number without a login', async () => {
    await prisma.serviceRequest.create({
      data: {
        srNumber: 'NYC-59489502',
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: RequestStatus.CLOSED,
        channel: Channel.PHONE,
        createdAt: new Date('2023-11-20T10:00:00Z'),
        closedAt: new Date('2023-11-22T10:00:00Z'),
        isImported: true,
        resolutionNote: 'The Department of Transportation inspected this complaint and repaired the problem.',
      },
    })

    const res = await request(app).get(`${api}/requests/NYC-59489502`).expect(200)
    expect(res.body.isImported).toBe(true)
    expect(res.body.resolutionNote).toContain('repaired the problem')
    // The provenance travels with the record, so a citizen reading a deadline
    // can see it was derived rather than promised.
    expect(res.body.slaNote).toContain('NYC publishes no due date')
  })

  it('404s on an unknown number', async () => {
    await request(app).get(`${api}/requests/NYC-does-not-exist`).expect(404)
  })
})

describe('the agency queue', () => {
  beforeEach(async () => {
    const now = referenceDate()
    await prisma.serviceRequest.createMany({
      data: [
        {
          srNumber: 'NYC-10',
          typeId: f.streetType,
          agencyId: f.dot,
          orgUnitId: f.board1,
          status: RequestStatus.OPEN,
          channel: Channel.PHONE,
          createdAt: new Date(now.getTime() - 10 * 86_400_000),
          slaDueAt: new Date(now.getTime() - 86_400_000),
          isImported: true,
        },
        {
          srNumber: 'NYC-11',
          typeId: f.streetType,
          agencyId: f.dot,
          orgUnitId: f.board2,
          status: RequestStatus.CLOSED,
          channel: Channel.ONLINE,
          createdAt: new Date(now.getTime() - 5 * 86_400_000),
          closedAt: new Date(now.getTime() - 4 * 86_400_000),
          isImported: true,
        },
        {
          srNumber: 'NYC-12',
          typeId: f.sanitationType,
          agencyId: f.dsny,
          orgUnitId: f.board1,
          status: RequestStatus.OPEN,
          channel: Channel.MOBILE,
          createdAt: new Date(now.getTime() - 3 * 86_400_000),
          isImported: true,
        },
      ],
    })
  })

  it('shows an agent their own agency and no one else’s', async () => {
    const res = await request(app)
      .get(`${api}/requests`)
      .set('Authorization', as(f.dotAgent, 'AGENT'))
      .expect(200)

    expect(res.body.total).toBe(2)
    expect(res.body.rows.every((r: { agency: { code: string } }) => r.agency.code === 'DOT')).toBe(true)
  })

  it('refuses a citizen', async () => {
    await request(app)
      .get(`${api}/requests`)
      .set('Authorization', as(f.citizen, 'CITIZEN'))
      .expect(403)
  })

  it('filters by board and by overdue', async () => {
    const byBoard = await request(app)
      .get(`${api}/requests?orgUnitId=${f.board2}`)
      .set('Authorization', as(f.dotAgent, 'AGENT'))
      .expect(200)
    expect(byBoard.body.total).toBe(1)

    const overdue = await request(app)
      .get(`${api}/requests?overdue=true`)
      .set('Authorization', as(f.dotAgent, 'AGENT'))
      .expect(200)
    // One of DOT's two is past its deadline and still open. Not both, and not
    // none — that is the whole point of the reference date.
    expect(overdue.body.total).toBe(1)
    expect(overdue.body.rows[0].srNumber).toBe('NYC-10')
  })

  it('pages rather than returning everything', async () => {
    const res = await request(app)
      .get(`${api}/requests?pageSize=1`)
      .set('Authorization', as(f.dotAgent, 'AGENT'))
      .expect(200)
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.total).toBe(2)
  })
})

describe('changing status', () => {
  let requestId: number

  beforeEach(async () => {
    const created = await prisma.serviceRequest.create({
      data: {
        srNumber: 'NYC-20',
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: RequestStatus.OPEN,
        channel: Channel.PHONE,
        createdAt: referenceDate(),
        isImported: true,
      },
    })
    requestId = created.id
  })

  it('records the transition and appends to the chain', async () => {
    await request(app)
      .patch(`${api}/requests/${requestId}/status`)
      .set('Authorization', as(f.dotAgent, 'AGENT'))
      .send({ status: RequestStatus.CLOSED, note: 'Repaired.' })
      .expect(200)

    const history = await prisma.requestStatusHistory.findMany({ where: { requestId } })
    expect(history).toHaveLength(1)
    expect(history[0]!.fromStatus).toBe(RequestStatus.OPEN)
    expect(history[0]!.toStatus).toBe(RequestStatus.CLOSED)
    expect(history[0]!.actorId).toBe(f.dotAgent)

    const updated = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })
    expect(updated.closedAt).not.toBeNull()
  })

  it('refuses an agent from another agency', async () => {
    // Agency-level accountability is the whole of Layer 0's access model. It is
    // also the only scope NYC's data supports: there is no individual owner to
    // check against.
    await request(app)
      .patch(`${api}/requests/${requestId}/status`)
      .set('Authorization', as(f.dsnyAgent, 'AGENT'))
      .send({ status: RequestStatus.CLOSED })
      .expect(403)
  })

  it('clears the closure stamp when a request is reopened', async () => {
    await request(app)
      .patch(`${api}/requests/${requestId}/status`)
      .set('Authorization', as(f.dotAgent, 'AGENT'))
      .send({ status: RequestStatus.CLOSED })
      .expect(200)
    await request(app)
      .patch(`${api}/requests/${requestId}/status`)
      .set('Authorization', as(f.dotAgent, 'AGENT'))
      .send({ status: RequestStatus.OPEN })
      .expect(200)

    const reopened = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })
    // "Closed" and "has a closedAt" must never disagree, or every resolution-time
    // figure quietly includes requests that are open.
    expect(reopened.closedAt).toBeNull()
  })
})
