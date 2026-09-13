/**
 * The NYC importer, pinned at the four places it could quietly corrupt the
 * study rather than fail.
 *
 * None of these produce an error when they go wrong. A mis-mapped status is a
 * plausible-looking row; a second import that rewrites everything looks like a
 * successful run; a fabricated status history is indistinguishable from a real
 * one once it is in the table; and overdue-by-wall-clock renders a working
 * screen where every request is late. That is why they are tests and not
 * review comments.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Channel, PrismaClient, RequestStatus } from '@prisma/client'
import * as audit from '../src/services/audit.js'
import { isOverdue, referenceDate } from '../src/config/systemClock.js'
import { Routing, importRows, mapChannel, mapRow, mapStatus, loadRefData, type NycRow } from '../scripts/import-nyc.js'

const prisma = new PrismaClient()

/** The derived p75 for Street Condition, as the SLA table publishes it. */
const STREET_CONDITION_SLA_HOURS = 110.3

/** Somewhere in the corpus, and comfortably before its last created_date. */
const REFERENCE = '2025-12-31T23:11:00.000Z'

async function reset() {
  await prisma.requestStatusHistory.deleteMany()
  await prisma.auditEvent.deleteMany()
  // Rows other files leave behind that reference users, agencies and units with
  // `Restrict`. Which file ran before this one is not this file's business.
  await prisma.workOrder.deleteMany()
  await prisma.assignment.deleteMany()
  await prisma.riskScore.deleteMany()
  await prisma.serviceRequest.deleteMany()
  await prisma.posting.deleteMany()
  await prisma.requestDescriptor.deleteMany()
  await prisma.user.deleteMany()
  await prisma.requestType.deleteMany()
  // Children before parents: the tree's self-relation is `Restrict`.
  await prisma.orgUnit.deleteMany({ where: { depth: 1 } })
  await prisma.orgUnit.deleteMany()
  await prisma.agency.deleteMany()
}

/**
 * The smallest reference data the importer will run against: one agency, one
 * complaint type, one borough and two of its boards. Deliberately built here
 * rather than by calling the seed — a test that fails because the SLA table
 * moved is a test that is measuring the wrong thing.
 */
async function seedReference() {
  const dot = await prisma.agency.create({ data: { code: 'DOT', name: 'Department of Transportation' } })
  const root = await prisma.orgUnit.create({
    data: { code: 'BK', name: 'Brooklyn', kindLabel: 'Borough', depth: 0, path: 'pending', isLeaf: false },
  })
  await prisma.orgUnit.update({ where: { id: root.id }, data: { path: `/${root.id}/` } })

  for (const n of [5, 11]) {
    const code = `BK-${String(n).padStart(2, '0')}`
    const board = await prisma.orgUnit.create({
      data: {
        code,
        name: `Community Board ${n}`,
        kindLabel: 'Community Board',
        depth: 1,
        path: 'pending',
        parentId: root.id,
      },
    })
    await prisma.orgUnit.update({ where: { id: board.id }, data: { path: `/${root.id}/${board.id}/` } })
  }

  await prisma.requestType.create({
    data: {
      code: 'street-condition',
      name: 'Street Condition',
      agencyId: dot.id,
      slaHours: STREET_CONDITION_SLA_HOURS,
      slaSource: 'DERIVED_P75',
      slaNote: 'Derived: 75th percentile of observed closure time. NYC publishes no due date for this type.',
    },
  })
}

/** One CSV record, shaped exactly like a line of `brooklyn.csv`. */
function row(overrides: Partial<NycRow> = {}): NycRow {
  return {
    unique_key: '58106347',
    created_date: '2023-07-05T11:35:15.000',
    closed_date: '2023-07-06T12:40:00.000',
    due_date: '',
    resolution_action_updated_date: '2023-07-06T12:40:00.000',
    agency: 'DOT',
    agency_name: 'Department of Transportation',
    complaint_type: 'Street Condition',
    descriptor: 'Pothole',
    status: 'Closed',
    borough: 'BROOKLYN',
    community_board: '05 BROOKLYN',
    council_district: '37',
    police_precinct: 'Precinct 75',
    incident_zip: '11208',
    incident_address: 'FULTON STREET',
    street_name: 'FULTON STREET',
    latitude: '40.68244551479475',
    longitude: '-73.89251633393714',
    open_data_channel_type: 'PHONE',
    resolution_description: 'The Department of Transportation inspected this complaint.',
    location_type: '',
    board: '5',
    resolution_hours: '25.079166666666666',
    ...overrides,
  }
}

beforeAll(() => {
  process.env.SYSTEM_REFERENCE_DATE = REFERENCE
})

beforeEach(async () => {
  await reset()
  await seedReference()
})

describe('mapping NYC values', () => {
  it('maps every published status one for one', () => {
    expect(mapStatus('Open')).toBe(RequestStatus.OPEN)
    expect(mapStatus('Assigned')).toBe(RequestStatus.ASSIGNED)
    expect(mapStatus('Started')).toBe(RequestStatus.STARTED)
    expect(mapStatus('In Progress')).toBe(RequestStatus.IN_PROGRESS)
    expect(mapStatus('Pending')).toBe(RequestStatus.PENDING)
    expect(mapStatus('Closed')).toBe(RequestStatus.CLOSED)
    expect(mapStatus('Unspecified')).toBe(RequestStatus.UNSPECIFIED)
  })

  /**
   * The failure that matters more than the successes. A status NYC starts
   * publishing that we have not seen must stop the import, because the only
   * other option is filing it as something it is not — and that produces a
   * database that looks complete and is wrong.
   */
  it('refuses an unrecognised status instead of defaulting it', () => {
    expect(() => mapStatus('Resolved', 'NYC-1')).toThrow(/Unrecognised NYC status/)
    expect(() => mapStatus('', 'NYC-1')).toThrow(/Unrecognised NYC status/)
  })

  it('maps every published channel one for one', () => {
    expect(mapChannel('PHONE')).toBe(Channel.PHONE)
    expect(mapChannel('ONLINE')).toBe(Channel.ONLINE)
    expect(mapChannel('MOBILE')).toBe(Channel.MOBILE)
    expect(mapChannel('OTHER')).toBe(Channel.OTHER)
    expect(mapChannel('UNKNOWN')).toBe(Channel.UNKNOWN)
  })

  it('reads a missing channel as UNKNOWN, which is a value NYC publishes too', () => {
    expect(mapChannel('')).toBe(Channel.UNKNOWN)
    expect(mapChannel(undefined)).toBe(Channel.UNKNOWN)
  })

  it('refuses an unrecognised channel instead of bucketing it into UNKNOWN', () => {
    expect(() => mapChannel('SMS', 'NYC-1')).toThrow(/Unrecognised NYC channel/)
  })

  /**
   * One type, one agency is assumed everywhere a queue is an agency's queue,
   * so it is asserted per row rather than trusted once.
   */
  it('stops when a complaint type turns up under a second agency', async () => {
    const ref = await loadRefData(prisma)
    const routing = new Routing()
    mapRow(row(), ref, routing)
    expect(() => mapRow(row({ unique_key: '2', agency: 'DSNY' }), ref, routing)).toThrow(/more than one agency/)
  })
})

describe('importing rows', () => {
  it('keeps NYC dates exactly as published and derives the deadline from them', async () => {
    await importRows(prisma, [row()])

    const request = await prisma.serviceRequest.findUniqueOrThrow({ where: { srNumber: 'NYC-58106347' } })
    expect(request.createdAt.toISOString()).toBe('2023-07-05T11:35:15.000Z')
    expect(request.closedAt?.toISOString()).toBe('2023-07-06T12:40:00.000Z')
    expect(request.slaDueAt?.getTime()).toBe(
      Math.round(request.createdAt.getTime() + STREET_CONDITION_SLA_HOURS * 3_600_000),
    )
    expect(request.isImported).toBe(true)
    expect(request.citizenId).toBeNull()
  })

  /**
   * NYC could not place 5,404 of the 355,430 requests. Dropping them would look
   * like a cleaner import and would quietly change every borough total.
   */
  it('keeps a request NYC could not place, attributed to no unit', async () => {
    await importRows(prisma, [row({ board: '', community_board: 'Unspecified BROOKLYN' })])

    const request = await prisma.serviceRequest.findUniqueOrThrow({ where: { srNumber: 'NYC-58106347' } })
    expect(request.orgUnitId).toBeNull()
  })

  it('files a request against its community board', async () => {
    await importRows(prisma, [row({ board: '11' })])

    const request = await prisma.serviceRequest.findUniqueOrThrow({
      where: { srNumber: 'NYC-58106347' },
      include: { orgUnit: true },
    })
    expect(request.orgUnit?.code).toBe('BK-11')
  })

  it('discovers descriptors from the corpus, once per type and name', async () => {
    await importRows(prisma, [row(), row({ unique_key: '2' }), row({ unique_key: '3', descriptor: 'Failed Street Repair' })])

    const descriptors = await prisma.requestDescriptor.findMany({ orderBy: { name: 'asc' } })
    expect(descriptors.map((d) => d.name)).toEqual(['Failed Street Repair', 'Pothole'])
  })
})

describe('running the import twice', () => {
  /**
   * Gate 1. The importer is the only thing that writes 355,430 rows, so an
   * accidental rewrite on every run is both invisible and expensive — and it
   * would churn `updatedAt` on the whole table, which anything watching for
   * recent activity would read as work happening.
   */
  it('changes nothing the second time', async () => {
    const rows = [row(), row({ unique_key: '2', status: 'Pending', closed_date: '', board: '11' })]

    const first = await importRows(prisma, rows)
    expect(first).toEqual({ read: 2, inserted: 2, updated: 0, unchanged: 0 })

    const before = await prisma.serviceRequest.findMany({ orderBy: { srNumber: 'asc' } })
    const auditBefore = await prisma.auditEvent.count()

    const second = await importRows(prisma, rows)
    expect(second).toEqual({ read: 2, inserted: 0, updated: 0, unchanged: 2 })

    const after = await prisma.serviceRequest.findMany({ orderBy: { srNumber: 'asc' } })
    expect(after).toEqual(before)
    expect(after.map((r) => r.updatedAt)).toEqual(before.map((r) => r.updatedAt))
    // A batch that changed nothing appends nothing: an entry claiming an import
    // happened when no row moved makes the chain longer and less true.
    expect(await prisma.auditEvent.count()).toBe(auditBefore)
    expect(await prisma.requestStatusHistory.count()).toBe(2)
  })

  it('updates a request in place when NYC republishes it differently', async () => {
    await importRows(prisma, [row({ status: 'Pending', closed_date: '', resolution_action_updated_date: '' })])
    const counts = await importRows(prisma, [row()])

    expect(counts).toEqual({ read: 1, inserted: 0, updated: 1, unchanged: 0 })
    const request = await prisma.serviceRequest.findUniqueOrThrow({ where: { srNumber: 'NYC-58106347' } })
    expect(request.status).toBe(RequestStatus.CLOSED)
  })
})

describe('the audit boundary', () => {
  /**
   * I5. NYC publishes no status history at all, and this table feeds the
   * process-mining event log that feeds a paper. A plausible
   * "assigned -> in progress -> closed" trace would be indistinguishable from
   * an observed one the moment it is written, and would travel from here into
   * a result.
   */
  it('writes exactly one status row per imported request, with no actor and nothing before it', async () => {
    await importRows(prisma, [row()])

    const history = await prisma.requestStatusHistory.findMany()
    expect(history).toHaveLength(1)
    expect(history[0]!.fromStatus).toBeNull()
    expect(history[0]!.actorId).toBeNull()
    expect(history[0]!.toStatus).toBe(RequestStatus.CLOSED)
    // NYC's own closure date, not the time the import happened.
    expect(history[0]!.at.toISOString()).toBe('2023-07-06T12:40:00.000Z')
  })

  it('never re-imports a request into a second, invented transition', async () => {
    await importRows(prisma, [row({ status: 'Pending', closed_date: '', resolution_action_updated_date: '' })])
    await importRows(prisma, [row()])

    const history = await prisma.requestStatusHistory.findMany()
    expect(history).toHaveLength(1)
    expect(history[0]!.toStatus).toBe(RequestStatus.CLOSED)
    expect(history[0]!.fromStatus).toBeNull()
  })

  it('appends one audit entry for the batch, says so, and leaves the chain valid', async () => {
    await importRows(prisma, [row(), row({ unique_key: '2' }), row({ unique_key: '3' })])

    const events = await prisma.auditEvent.findMany()
    expect(events).toHaveLength(1)
    expect(events[0]!.actorId).toBeNull()
    expect(events[0]!.source).toBe('import')
    const payload = events[0]!.payload as Record<string, unknown>
    expect(payload.requests).toBe(3)
    expect(String(payload.note)).toMatch(/per import batch, not per request/)
    expect((await audit.verifyChain(prisma)).valid).toBe(true)
  })
})

describe('the system clock', () => {
  /**
   * F-04, the mistake this project has already made once. The corpus ends in
   * 2025 and wall-clock time is past it, so `Date.now()` marks every imported
   * request overdue — 100% breach on every screen, which looks like a working
   * feature.
   */
  it('measures overdue against the reference date and not the wall clock', async () => {
    // Filed the day before the reference date, so its deadline falls after it.
    await importRows(prisma, [
      row({ unique_key: '900', created_date: '2025-12-30T09:00:00.000', status: 'Pending', closed_date: '' }),
      row({ unique_key: '901', created_date: '2022-03-01T09:00:00.000', status: 'Pending', closed_date: '' }),
    ])

    const recent = await prisma.serviceRequest.findUniqueOrThrow({ where: { srNumber: 'NYC-900' } })
    const old = await prisma.serviceRequest.findUniqueOrThrow({ where: { srNumber: 'NYC-901' } })

    expect(referenceDate().toISOString()).toBe(REFERENCE)
    expect(isOverdue(recent.slaDueAt)).toBe(false)
    expect(isOverdue(old.slaDueAt)).toBe(true)

    // And the distinction is real: judged by the wall clock, both are late.
    expect(recent.slaDueAt!.getTime()).toBeLessThan(Date.now())
  })

  it('refuses a reference date it cannot parse rather than treating nothing as overdue', () => {
    process.env.SYSTEM_REFERENCE_DATE = 'last tuesday'
    expect(() => referenceDate()).toThrow(/not a date/)
    process.env.SYSTEM_REFERENCE_DATE = REFERENCE
  })
})
