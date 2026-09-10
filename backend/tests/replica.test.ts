/**
 * The read surfaces: taxonomy, boards, the map, and the audit chain.
 *
 * What these have in common is that every one of them is a place where the
 * replica could silently stop being honest. The taxonomy could hand out a
 * deadline with no provenance. The board register could report a mean where the
 * distribution demands a median. The map could try to ship 350,000 points to a
 * browser. The audit endpoint could report a chain that verifies because nothing
 * was ever written to it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Channel, RequestStatus } from '@prisma/client'
import { createApp } from '../src/app.js'
import { referenceDate } from '../src/config/systemClock.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import * as audit from '../src/services/audit.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
let f: Fixture

beforeEach(async () => {
  await reset()
  f = await build()
})

const agent = () => `Bearer ${signToken(f.dotAgent, 'access', 'AGENT')}`

describe('taxonomy', () => {
  it('is public, two-level, and never quotes an SLA without its provenance', async () => {
    const res = await request(app).get(`${api}/taxonomy`).expect(200)

    const street = res.body.find((t: { name: string }) => t.name === 'Street Condition')
    expect(street.agency.code).toBe('DOT')
    expect(street.slaHours).toBeCloseTo(110.3)
    expect(street.slaSource).toBe('DERIVED_P75')
    // The sentence has to travel with the number. NYC publishes no due date for
    // any of these types, so a figure shown bare reads as a promise the City
    // made — which is exactly the trap the old assumed constants fell into.
    expect(street.slaNote).toMatch(/derived/i)
    expect(street.slaNote).toMatch(/no due date/i)
    expect(street.descriptors).toEqual([{ id: f.streetDescriptor, name: 'Pothole' }])
  })
})

describe('the board register', () => {
  beforeEach(async () => {
    const now = referenceDate()
    const day = 86_400_000
    // Three closed requests on board 1 at 1, 2 and 100 hours. The mean is 34.3
    // and the median is 2 — a gap that only widens on the real corpus, where
    // Street Light Condition runs p50 139h against p90 1,881h.
    await prisma.serviceRequest.createMany({
      data: [1, 2, 100].map((hours, i) => ({
        srNumber: `NYC-3${i}`,
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: RequestStatus.CLOSED,
        channel: Channel.ONLINE,
        createdAt: new Date(now.getTime() - 10 * day),
        closedAt: new Date(now.getTime() - 10 * day + hours * 3_600_000),
        isImported: true,
      })),
    })
    // One still open and past its deadline, on the same board.
    await prisma.serviceRequest.create({
      data: {
        srNumber: 'NYC-40',
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: RequestStatus.OPEN,
        channel: Channel.PHONE,
        createdAt: new Date(now.getTime() - 20 * day),
        slaDueAt: new Date(now.getTime() - day),
        isImported: true,
      },
    })
  })

  it('reports a median, not a mean', async () => {
    const res = await request(app).get(`${api}/boards`).expect(200)
    const board1 = res.body.find((b: { code: string }) => b.code === 'BK-01')

    expect(board1.total).toBe(4)
    expect(board1.closed).toBe(3)
    expect(board1.open).toBe(1)
    expect(board1.overdue).toBe(1)
    // 2, not 34.3.
    expect(board1.medianResolutionHours).toBeCloseTo(2, 5)
  })

  it('lists every board, including ones with no requests at all', async () => {
    const res = await request(app).get(`${api}/boards`).expect(200)
    const board2 = res.body.find((b: { code: string }) => b.code === 'BK-02')
    // A board with no work is a real answer and has to appear; dropping it would
    // make the register silently disagree with the borough it belongs to.
    expect(board2.total).toBe(0)
    expect(board2.medianResolutionHours).toBeNull()
  })

  it('does not list the borough itself', async () => {
    const res = await request(app).get(`${api}/boards`).expect(200)
    expect(res.body.some((b: { code: string }) => b.code === 'BK')).toBe(false)
  })
})

describe('the map', () => {
  beforeEach(async () => {
    const now = referenceDate()
    // Two points a few metres apart, and one a long way off.
    const points = [
      { lat: 40.6782, lng: -73.9442 },
      { lat: 40.6783, lng: -73.9443 },
      { lat: 40.7182, lng: -73.9842 },
    ]
    await prisma.serviceRequest.createMany({
      data: points.map((p, i) => ({
        srNumber: `NYC-5${i}`,
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: RequestStatus.OPEN,
        channel: Channel.MOBILE,
        createdAt: now,
        latitude: p.lat,
        longitude: p.lng,
        isImported: true,
      })),
    })
  })

  it('clusters in the database and returns counts, not points', async () => {
    // Clustering server-side is a requirement rather than an optimisation:
    // Brooklyn holds ~350,000 located requests, and shipping them to Leaflet
    // means a 40MB response and a tab that stops responding.
    const res = await request(app)
      .get(`${api}/map/clusters?bbox=-74.1,40.5,-73.8,40.8&zoom=10`)
      .set('Authorization', agent())
      .expect(200)

    const total = res.body.reduce((n: number, c: { count: number }) => n + c.count, 0)
    expect(total).toBe(3)
    // At zoom 10 the cell is a couple of kilometres across: the two neighbours
    // share it and the far point does not.
    expect(res.body.length).toBe(2)
    expect(res.body[0].count).toBe(2)
  })

  it('breaks a cluster apart as the map zooms in', async () => {
    // The same two points, eleven metres apart. They share a cell at every zoom
    // where the cell is wider than they are apart, and separate once it is not —
    // which on this grid is around zoom 20, close enough to read house numbers.
    const res = await request(app)
      .get(`${api}/map/clusters?bbox=-74.1,40.5,-73.8,40.8&zoom=20`)
      .set('Authorization', agent())
      .expect(200)
    expect(res.body.length).toBe(3)
  })

  it('excludes what falls outside the viewport', async () => {
    const res = await request(app)
      .get(`${api}/map/clusters?bbox=-73.96,40.67,-73.93,40.69&zoom=12`)
      .set('Authorization', agent())
      .expect(200)
    const total = res.body.reduce((n: number, c: { count: number }) => n + c.count, 0)
    expect(total).toBe(2)
  })

  it('rejects a nonsense bounding box rather than scanning the table', async () => {
    await request(app)
      .get(`${api}/map/clusters?bbox=-73.8,40.5,-74.1,40.8&zoom=12`)
      .set('Authorization', agent())
      .expect(400)
  })
})

describe('audit verification', () => {
  it('reports a chain that verifies', async () => {
    await audit.record(prisma, {
      action: 'request.imported',
      entityType: 'request',
      entityId: '1',
      payload: { source: 'NYC Open Data' },
      source: 'import',
    })

    const res = await request(app).get(`${api}/audit/verify`).set('Authorization', agent()).expect(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.checked).toBe(1)
  })

  it('names the row that fails when an entry is edited after the fact', async () => {
    const first = await audit.record(prisma, {
      action: 'request.filed',
      entityType: 'request',
      entityId: '1',
      payload: { srNumber: 'DG-2026-000001' },
    })
    await audit.record(prisma, {
      action: 'request.status_changed',
      entityType: 'request',
      entityId: '1',
      payload: { to: 'CLOSED' },
    })

    // Tamper: change the content without recomputing the hash, which is exactly
    // what an edit through psql or a migration would look like.
    await prisma.auditEvent.update({
      where: { id: first.id },
      data: { payload: { srNumber: 'DG-2026-999999' } },
    })

    const res = await request(app).get(`${api}/audit/verify`).set('Authorization', agent()).expect(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.brokenAt).toBe(first.id)
    expect(res.body.reason).toMatch(/edited after the fact/)
  })

  it('is not public', async () => {
    await request(app).get(`${api}/audit/verify`).expect(401)
  })
})

describe('the API root', () => {
  it('says what this is before anyone can mistake it for the real thing', async () => {
    const res = await request(app).get('/').expect(200)
    expect(res.body.description).toMatch(/replica/i)
    expect(res.body.description).toMatch(/NYC Open Data/)
    expect(res.body.affiliation).toMatch(/Not affiliated/i)
  })
})
