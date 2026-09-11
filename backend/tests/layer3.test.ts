/**
 * Layer 3 — GRIE — and the property everything else rests on: the backend
 * computes the study's signals and applies the study's model, exactly.
 *
 * The full check runs against the real corpus in `npm run layer3:measure`. What
 * can be pinned here, on a month built by hand, is each signal's definition —
 * the parts that are easy to get subtly wrong: a deadline that falls after the
 * month closes, a request closed before it was filed, a duplicate that must not
 * count as a repeat, an address written two ways.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Channel, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { calibrate, GRIE_CONTRACT, grieSpec, normalise, scoreUnit, type GrieSpec } from '../src/services/grie.js'
import { loadSpec } from '../src/services/modelSpec.js'
import { unitMonths } from '../src/services/riskSignals.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const HOUR = 3_600_000
const SLA_HOURS = 110.3

const bearer = (id: number, role: Role) => `Bearer ${signToken(id, 'access', role)}`

const spec: GrieSpec = {
  contract: GRIE_CONTRACT,
  modelVersion: 'test',
  chosen: 'tuned_nyc',
  unit: 'agency x community board x calendar month',
  minRequests: 20,
  label: { description: 'worst fifth next month', quantile: 0.8, cutoff: 0.35, baseRate: 0.2 },
  trainedOn: { rows: 0, units: 0, firstMonth: '', lastMonth: '' },
  markers: { referral: [], enforcement: [], duplicate: [] },
  factors: [
    { key: 'slaBreachRate', label: 'Missed deadlines', weight: 0.8, curve: { kind: 'proportion' } },
    { key: 'repeatComplaintRate', label: 'Repairs that did not hold', weight: 0.05, curve: { kind: 'proportion' } },
    { key: 'escalationRate', label: 'Referred or enforced', weight: 0.05, curve: { kind: 'proportion' } },
    {
      key: 'openComplaintLoad',
      label: 'Open requests',
      weight: 0.05,
      curve: { kind: 'linear', cap: 400, capByAgency: { DEP: 100 } },
    },
    { key: 'avgResolutionDays', label: 'Days to close', weight: 0.05, curve: { kind: 'linear', cap: 20 } },
  ],
  handSpecified: {
    weights: {
      slaBreachRate: 0.28,
      repeatComplaintRate: 0.27,
      escalationRate: 0.2,
      openComplaintLoad: 0.15,
      avgResolutionDays: 0.1,
    },
    caps: { openComplaintLoad: 25, avgResolutionDays: 14 },
  },
  calibration: { kind: 'isotonic', x: [10, 20, 40], y: [0.05, 0.2, 0.6] },
  reviewProbability: 0.5,
  evaluation: {
    candidates: {},
    shippedVsHand: { aucGap: 0, ciLow: 0, ciHigh: 0 },
    shippedVsPersistence: { aucGap: 0, ciLow: 0, ciHigh: 0 },
    calibration: {},
  },
}

describe('the scoring maths', () => {
  it('caps a linear signal at the agency’s own cap when it has one', () => {
    const curve = spec.factors[3]!.curve
    expect(normalise(curve, 50, 'DEP')).toBe(50)
    expect(normalise(curve, 50, 'DOT')).toBe(12.5)
    expect(normalise(curve, 900, 'DOT')).toBe(100)
    expect(normalise(curve, -3, 'DOT')).toBe(0)
  })

  it('calibrates as scikit-learn does: linear between thresholds, clipped outside', () => {
    expect(calibrate(spec.calibration, 0)).toBe(0.05)
    expect(calibrate(spec.calibration, 20)).toBe(0.2)
    expect(calibrate(spec.calibration, 30)).toBeCloseTo(0.4, 12)
    expect(calibrate(spec.calibration, 99)).toBe(0.6)
  })

  it('scores a unit as the weighted sum, explains it, and calibrates it', () => {
    const result = scoreUnit(
      spec,
      { slaBreachRate: 0.5, repeatComplaintRate: 0.2, escalationRate: 0.1, openComplaintLoad: 200, avgResolutionDays: 10 },
      'DOT',
    )
    // 0.8 x 50 + 0.05 x (20 + 10 + 50 + 50)
    expect(result.score).toBeCloseTo(46.5, 12)
    expect(result.probability).toBe(0.6)
    expect(result.needsReview).toBe(true)
    expect(result.factors[0]!.factor).toBe('slaBreachRate')
    expect(result.topReason).toMatch(/50% of requests filed this month passed their derived deadline/)
  })

  it('runs the exported model only under the contract it was written for', () => {
    const exported = loadSpec<GrieSpec>('grie-spec.json', GRIE_CONTRACT)
    expect(exported).not.toBeNull()
    expect(exported!.factors.reduce((sum, f) => sum + f.weight, 0)).toBeCloseTo(1, 9)
    expect(loadSpec('grie-spec.json', 'grie-nyc/0')).toBeNull()
  })
})

let f: Fixture
let admin: number
let counter = 0

async function requests(
  rows: { day: string; closedAfterHours?: number | null; address: string; note?: string }[],
) {
  await prisma.serviceRequest.createMany({
    data: rows.map((row) => {
      const createdAt = new Date(`${row.day}T10:00:00.000Z`)
      const closedAt =
        row.closedAfterHours == null ? null : new Date(createdAt.getTime() + row.closedAfterHours * HOUR)
      return {
        srNumber: `NYC-${900000 + ++counter}`,
        typeId: f.streetType,
        agencyId: f.dot,
        orgUnitId: f.board1,
        status: closedAt ? RequestStatus.CLOSED : RequestStatus.OPEN,
        channel: Channel.PHONE,
        createdAt,
        closedAt,
        slaDueAt: new Date(createdAt.getTime() + SLA_HOURS * HOUR),
        address: row.address,
        resolutionNote: row.note ?? null,
        isImported: true,
      }
    }),
  })
}

/**
 * January 2024 on Board 1, built so every signal has a known answer.
 *
 *   filed 20; breached 6 (four closed after ten days, two still open with a
 *   deadline inside January; two more open ones are due in February and are
 *   not breached yet) -> 0.30
 *   repeats 3 of 19, all at 100 MAIN ST after December's closed one — one of
 *   them filed straight after a request there that is still open, which must
 *   not interrupt the run of earlier closures (F-39); a fourth there is NYC's
 *   declared duplicate and leaves the denominator -> 3/19
 *   referred or enforced 1 -> 0.05
 *   open at the close of January 4
 *   days to close: fifteen with a knowable duration, 51 days in all -> 3.4;
 *   the one closed an hour before it was filed is left out (F-29)
 *   February's rate 5 of 20 -> 0.25
 */
async function januaryOnBoard1() {
  const oneDay = 24
  await requests([{ day: '2023-12-01', closedAfterHours: 14 * oneDay, address: '100 MAIN ST' }])
  const january = [
    { day: '2024-01-03', closedAfterHours: oneDay, address: '100 main st ' },
    { day: '2024-01-06', closedAfterHours: oneDay, address: '100 MAIN ST' },
    {
      day: '2024-01-08',
      closedAfterHours: oneDay,
      address: '100 MAIN ST',
      note: 'This complaint is a duplicate of a previously filed complaint.',
    },
    ...[3, 4, 5, 6, 7, 8, 9].map((i) => ({
      day: `2024-01-${String(i + 2).padStart(2, '0')}`,
      closedAfterHours: oneDay,
      address: `${i} OAK ST`,
    })),
    ...[10, 11, 12, 13].map((i) => ({ day: `2024-01-${i}`, closedAfterHours: 10 * oneDay, address: `${i} OAK ST` })),
    { day: '2024-01-29', closedAfterHours: null, address: '14 OAK ST' },
    { day: '2024-01-30', closedAfterHours: null, address: '15 OAK ST' },
    { day: '2024-01-05', closedAfterHours: null, address: '100 MAIN ST' },
    { day: '2024-01-06', closedAfterHours: null, address: '17 OAK ST' },
    {
      day: '2024-01-20',
      closedAfterHours: oneDay,
      address: '18 OAK ST',
      note: 'The Department of Transportation issued a summons for this condition.',
    },
    { day: '2024-01-25', closedAfterHours: -1, address: '19 OAK ST' },
  ]
  await requests(january)
  await requests(
    Array.from({ length: 20 }, (_, i) => ({
      day: `2024-02-${String(i + 1).padStart(2, '0')}`,
      closedAfterHours: i < 5 ? 10 * oneDay : oneDay,
      address: `${i} ELM ST`,
    })),
  )
}

beforeEach(async () => {
  await reset()
  f = await build()
  admin = (
    await prisma.user.create({
      data: {
        email: 'admin@example.invalid',
        name: 'Platform Administrator',
        passwordHash: 'x',
        role: Role.ADMIN,
        isSynthetic: true,
      },
    })
  ).id
})

describe('the five signals, computed from the database', () => {
  it('reproduce the study’s definitions on a month with a known answer', async () => {
    await januaryOnBoard1()
    const months = await unitMonths(grieSpec()!.markers, 20)
    // December has one request: too thin to score, and left out.
    expect(months.map((m) => m.month.toISOString().slice(0, 7))).toEqual(['2024-01', '2024-02'])

    const january = months[0]!
    expect(january).toMatchObject({ agencyCode: 'DOT', boardCode: 'BK-01', requests: 20, openComplaintLoad: 4 })
    expect(january.slaBreachRate).toBeCloseTo(0.3, 12)
    expect(january.repeatComplaintRate).toBeCloseTo(3 / 19, 12)
    expect(january.escalationRate).toBeCloseTo(0.05, 12)
    expect(january.avgResolutionDays).toBeCloseTo(3.4, 9)
    expect(january.nextBreachRate).toBeCloseTo(0.25, 12)

    // February's successor is not on record.
    expect(months[1]!.nextBreachRate).toBeNull()
    expect(months[1]!.openComplaintLoad).toBe(4)
  })
})

describe('the risk register', () => {
  it('is the administrator’s alone', async () => {
    await request(app).get(`${api}/risk/units`).expect(401)
    await request(app).get(`${api}/risk/units`).set('Authorization', bearer(f.dotAgent, Role.AGENT)).expect(403)
    await request(app).get(`${api}/routing/accuracy`).set('Authorization', bearer(f.dotAgent, Role.AGENT)).expect(403)
  })

  it('stores every scoreable month with its outcome, and ranks within the agency', async () => {
    await januaryOnBoard1()
    const recomputed = await request(app)
      .post(`${api}/risk/recompute`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)
    expect(recomputed.body).toMatchObject({ unitMonths: 2, firstMonth: '2024-01', lastMonth: '2024-02' })

    const res = await request(app)
      .get(`${api}/risk/units?month=2024-01`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)
    expect(res.body.rows).toHaveLength(1)
    const row = res.body.rows[0]
    expect(row).toMatchObject({ rank: 1, of: 1, requests: 20, nextBreachRate: 0.25 })
    // 0.25 is under the panel's worst-fifth cutoff, so January did not "fail".
    expect(row.outcome).toBe(false)
    expect(row.probability).toBeGreaterThanOrEqual(0)
    expect(row.probability).toBeLessThanOrEqual(1)
    expect(row.factors).toHaveLength(5)

    // Recomputing replaces rather than stacks.
    await request(app).post(`${api}/risk/recompute`).set('Authorization', bearer(admin, Role.ADMIN)).expect(200)
    expect(await prisma.riskScore.count()).toBe(2)
    expect(await prisma.auditEvent.count({ where: { action: 'risk.recomputed' } })).toBe(2)
  })

  it('serves the routing measurement and the audit chain to the administrator', async () => {
    const routing = await request(app)
      .get(`${api}/routing/accuracy`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)
    expect(routing.body.evaluation.testYear).toBe(2025)
    expect(routing.body.cells.length).toBeGreaterThan(0)

    const verify = await request(app)
      .get(`${api}/admin/audit/verify`)
      .set('Authorization', bearer(admin, Role.ADMIN))
      .expect(200)
    expect(verify.body.ok).toBe(true)
  })
})
