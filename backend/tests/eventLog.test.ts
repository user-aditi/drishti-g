/**
 * The event log projection.
 *
 * The property that matters is that the projection is *lossless*. Every module
 * downstream of it — the CSV export, the research harness, any model trained on
 * "what usually happens next" — treats it as the record of what the system did.
 * A projection that silently dropped a transition, or emitted one twice, would
 * not fail loudly anywhere; it would quietly move a number in a paper.
 *
 * So the central assertion is a count identity: exactly one row out per
 * ComplaintStatusHistory row in, with no row missing the two fields that make it
 * an event log at all.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ComplaintStatus } from '@prisma/client'
import {
  CSV_COLUMNS,
  buildEventLog,
  summariseEventLog,
  toCsv,
} from '../src/services/eventLog.js'
import { build, complaint, prisma, type Fixture } from './fixture.js'

/**
 * The raw projection — no reconstructed case-start rows.
 *
 * Most assertions here are about the projection being a faithful mirror of
 * ComplaintStatusHistory, so they opt out of the one row the service adds that
 * the table does not hold. The reconstruction has its own block at the bottom.
 */
const RAW = { includeCaseStart: false } as const

let f: Fixture

beforeAll(async () => {
  f = await build()
})

beforeEach(async () => {
  await prisma.complaintStatusHistory.deleteMany()
  await prisma.complaint.deleteMany()
})

/** Walk a complaint through a lifecycle, writing history as the app does. */
async function walk(
  complaintId: number,
  steps: { to: ComplaintStatus; actorId?: number; at?: Date }[],
) {
  let from: ComplaintStatus | null = null
  for (const step of steps) {
    await prisma.complaintStatusHistory.create({
      data: {
        complaintId,
        fromStatus: from,
        toStatus: step.to,
        actorId: step.actorId ?? null,
        ...(step.at ? { createdAt: step.at } : {}),
      },
    })
    from = step.to
  }
}

describe('the projection loses nothing', () => {
  it('emits exactly one row per status-history row', async () => {
    const a = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    const b = await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })

    await walk(a.id, [
      { to: ComplaintStatus.SUBMITTED },
      { to: ComplaintStatus.ROUTED },
      { to: ComplaintStatus.ASSIGNED, actorId: f.sector1Officer },
    ])
    await walk(b.id, [{ to: ComplaintStatus.SUBMITTED }, { to: ComplaintStatus.ROUTED }])

    const stored = await prisma.complaintStatusHistory.count()
    const log = await buildEventLog(RAW)

    expect(stored).toBe(5)
    expect(log).toHaveLength(stored)
  })

  it('never emits a row without a case id or an activity', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await walk(c.id, [
      { to: ComplaintStatus.SUBMITTED },
      { to: ComplaintStatus.ROUTED },
      { to: ComplaintStatus.RESOLVED, actorId: f.sector1Officer },
    ])

    for (const row of await buildEventLog(RAW)) {
      expect(row.caseId).toBeTruthy()
      expect(row.activity).toBeTruthy()
      expect(row.timestamp).toBeInstanceOf(Date)
    }
  })

  it('joins the case attributes onto every row', async () => {
    const c = await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })
    await walk(c.id, [{ to: ComplaintStatus.SUBMITTED }])

    const [row] = await buildEventLog(RAW)
    expect(row!.caseId).toBe(c.referenceNo)
    expect(row!.orgUnitId).toBe(f.sector2)
    expect(row!.departmentId).toBe(f.deepDept)
    expect(row!.priority).toBe('MEDIUM')
    expect(row!.escalationLevel).toBe(0)
  })
})

describe('ordering', () => {
  /**
   * A burst of transitions written inside one transaction can share a timestamp
   * to the millisecond. Handed to a process miner in an arbitrary order, those
   * become transitions that never happened.
   */
  it('breaks timestamp ties by insertion order, not arbitrarily', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    const sameInstant = new Date('2026-03-01T10:00:00.000Z')

    await walk(c.id, [
      { to: ComplaintStatus.SUBMITTED, at: sameInstant },
      { to: ComplaintStatus.ROUTED, at: sameInstant },
      { to: ComplaintStatus.ASSIGNED, at: sameInstant },
    ])

    const log = await buildEventLog(RAW)
    expect(log.map((r) => r.activity)).toEqual(['SUBMITTED', 'ROUTED', 'ASSIGNED'])
  })

  it('returns the log oldest first', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await walk(c.id, [
      { to: ComplaintStatus.SUBMITTED, at: new Date('2026-01-05T00:00:00Z') },
      { to: ComplaintStatus.ROUTED, at: new Date('2026-01-03T00:00:00Z') },
    ])

    const log = await buildEventLog(RAW)
    expect(log[0]!.activity).toBe('ROUTED')
  })
})

describe('the resource column', () => {
  it('distinguishes an officer from the system', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await walk(c.id, [
      { to: ComplaintStatus.SUBMITTED },
      { to: ComplaintStatus.ASSIGNED, actorId: f.sector1Officer },
    ])

    const log = await buildEventLog(RAW)
    // A null resource is the signal that the scheduler acted, not an officer.
    expect(log[0]!.resource).toBeNull()
    expect(log[1]!.resource).toContain(String(f.sector1Officer))
  })
})

describe('date filtering', () => {
  it('bounds the log inclusively below and exclusively above', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await walk(c.id, [
      { to: ComplaintStatus.SUBMITTED, at: new Date('2026-01-01T00:00:00Z') },
      { to: ComplaintStatus.ROUTED, at: new Date('2026-02-01T00:00:00Z') },
      { to: ComplaintStatus.ASSIGNED, at: new Date('2026-03-01T00:00:00Z') },
    ])

    const log = await buildEventLog({
      ...RAW,
      from: new Date('2026-02-01T00:00:00Z'),
      to: new Date('2026-03-01T00:00:00Z'),
    })

    expect(log.map((r) => r.activity)).toEqual(['ROUTED'])
  })
})

describe('the summary behind the download control', () => {
  it('counts events, distinct cases and the span', async () => {
    const a = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    const b = await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })
    await walk(a.id, [
      { to: ComplaintStatus.SUBMITTED, at: new Date('2026-01-01T00:00:00Z') },
      { to: ComplaintStatus.ROUTED, at: new Date('2026-01-02T00:00:00Z') },
    ])
    await walk(b.id, [{ to: ComplaintStatus.SUBMITTED, at: new Date('2026-01-10T00:00:00Z') }])

    const summary = await summariseEventLog(RAW)
    expect(summary.events).toBe(3)
    expect(summary.cases).toBe(2)
    expect(summary.from).toEqual(new Date('2026-01-01T00:00:00Z'))
    expect(summary.to).toEqual(new Date('2026-01-10T00:00:00Z'))
  })

  it('reports an empty log without throwing', async () => {
    expect(await summariseEventLog(RAW)).toEqual({ events: 0, cases: 0, from: null, to: null })
  })
})

describe('CSV serialisation', () => {
  it('writes a header pm4py can read and one line per event', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await walk(c.id, [{ to: ComplaintStatus.SUBMITTED }, { to: ComplaintStatus.ROUTED }])

    const csv = toCsv(await buildEventLog(RAW))
    const lines = csv.trimEnd().split('\r\n')

    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines).toHaveLength(3)
    expect(lines[1]!.split(',')[1]).toBe('SUBMITTED')
  })

  it('escapes a field containing a comma rather than shifting the columns', async () => {
    const c = await complaint(f, {
      unitId: f.sector1,
      departmentId: f.deepDept,
      title: 'Pothole, deep',
    })
    // referenceNo is generated, so force a comma into the case id itself — the
    // column that would corrupt every downstream row if it were not escaped.
    await prisma.complaint.update({
      where: { id: c.id },
      data: { referenceNo: 'DG-2026,000042' },
    })
    await walk(c.id, [{ to: ComplaintStatus.SUBMITTED }])

    const line = toCsv(await buildEventLog(RAW)).trimEnd().split('\r\n')[1]!
    expect(line.startsWith('"DG-2026,000042",SUBMITTED,')).toBe(true)
  })

  it('writes null as an empty field, not the string "null"', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await walk(c.id, [{ to: ComplaintStatus.SUBMITTED }])

    const line = toCsv(await buildEventLog(RAW)).trimEnd().split('\r\n')[1]!
    expect(line).not.toContain('null')
    // from_activity is null on a case's first event.
    expect(line.split(',')[2]).toBe('')
  })
})

/**
 * The one row the projection adds that the table does not hold.
 *
 * Filing writes no history row — the complaint is created already in SUBMITTED,
 * so nothing transitions into it. Left alone, every case in the log begins at
 * the transition *out of* SUBMITTED, pm4py reports start activities of ASSIGNED
 * and AWAITING_VERIFICATION, and throughput measured from the log begins after
 * routing rather than at filing. This block pins the reconstruction and, more
 * importantly, pins that it never fires where the row already exists.
 */
describe('the reconstructed case start', () => {
  it('prepends a SUBMITTED event when the history begins by leaving SUBMITTED', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await prisma.complaint.update({
      where: { id: c.id },
      data: { createdAt: new Date('2026-01-01T09:00:00Z') },
    })
    await prisma.complaintStatusHistory.create({
      data: {
        complaintId: c.id,
        fromStatus: ComplaintStatus.SUBMITTED,
        toStatus: ComplaintStatus.ASSIGNED,
        createdAt: new Date('2026-01-01T11:00:00Z'),
      },
    })

    const log = await buildEventLog()
    expect(log.map((r) => r.activity)).toEqual(['SUBMITTED', 'ASSIGNED'])
    expect(log[0]!.timestamp).toEqual(new Date('2026-01-01T09:00:00Z'))
    expect(log[0]!.fromActivity).toBeNull()
    // Reconstructed, so it attests to no actor.
    expect(log[0]!.resource).toBeNull()
    expect(log[0]!.actorId).toBeNull()
  })

  it('adds nothing when the case already has its SUBMITTED row', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await walk(c.id, [{ to: ComplaintStatus.SUBMITTED }, { to: ComplaintStatus.ROUTED }])

    const log = await buildEventLog()
    expect(log).toHaveLength(2)
    expect(log.filter((r) => r.activity === 'SUBMITTED')).toHaveLength(1)
  })

  it('adds one start per case, not one per event', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await prisma.complaintStatusHistory.createMany({
      data: [
        { complaintId: c.id, fromStatus: ComplaintStatus.SUBMITTED, toStatus: ComplaintStatus.ASSIGNED },
        { complaintId: c.id, fromStatus: ComplaintStatus.ASSIGNED, toStatus: ComplaintStatus.IN_PROGRESS },
        { complaintId: c.id, fromStatus: ComplaintStatus.IN_PROGRESS, toStatus: ComplaintStatus.RESOLVED },
      ],
    })

    const log = await buildEventLog()
    expect(log.filter((r) => r.activity === 'SUBMITTED')).toHaveLength(1)
    expect(log).toHaveLength(4)
  })

  /**
   * A sliced log must not sprout an event before the window it was asked for —
   * that would put a row in the file outside the range the caller requested.
   */
  it('does not reach outside a date window to invent a start', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await prisma.complaint.update({
      where: { id: c.id },
      data: { createdAt: new Date('2026-01-01T00:00:00Z') },
    })
    await prisma.complaintStatusHistory.create({
      data: {
        complaintId: c.id,
        fromStatus: ComplaintStatus.SUBMITTED,
        toStatus: ComplaintStatus.ASSIGNED,
        createdAt: new Date('2026-02-15T00:00:00Z'),
      },
    })

    const log = await buildEventLog({ from: new Date('2026-02-01T00:00:00Z') })
    expect(log.map((r) => r.activity)).toEqual(['ASSIGNED'])
  })

  it('leaves every case with a start activity, which is the point', async () => {
    const a = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    const b = await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })
    for (const id of [a.id, b.id]) {
      await prisma.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: ComplaintStatus.SUBMITTED,
          toStatus: ComplaintStatus.ASSIGNED,
        },
      })
    }

    const log = await buildEventLog()
    const firstActivityPerCase = new Map<string, string>()
    for (const row of log) {
      if (!firstActivityPerCase.has(row.caseId)) firstActivityPerCase.set(row.caseId, row.activity)
    }
    expect([...firstActivityPerCase.values()]).toEqual(['SUBMITTED', 'SUBMITTED'])
  })
})
