/**
 * GRIE's recurrence factor.
 *
 * The property worth pinning: a wave is not a recurrence. The original
 * definition counted every complaint in a category the area had seen before,
 * which reduces to 1 - (distinct categories / n). With a fixed catalogue that
 * climbs towards 1.0 for any busy area whether or not anything came back, so
 * the factor duplicated `openComplaintLoad` at 0.27 weight while claiming on
 * screen to measure something else.
 *
 * A repeat is now an issue this area resolved and is seeing again — the repair
 * not holding. These tests are the difference between the two definitions.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { collectUnitSignals } from '../src/services/riskSignals.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

let f: Fixture
let potholes: number
let lights: number

const DAY = 86_400_000

/** A complaint with explicit dates, which the shared helper does not expose. */
async function filed(opts: {
  unitId: number
  categoryId: number
  daysAgo: number
  resolvedDaysAgo?: number
  duplicateOfId?: number
}) {
  return prisma.complaint.create({
    data: {
      referenceNo: `RPT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      title: 'Test complaint',
      description: 'Test complaint',
      citizenId: f.citizen,
      departmentId: f.deepDept,
      orgUnitId: opts.unitId,
      categoryId: opts.categoryId,
      status: opts.resolvedDaysAgo != null ? 'RESOLVED' : 'ASSIGNED',
      priority: 'MEDIUM',
      createdAt: new Date(Date.now() - opts.daysAgo * DAY),
      resolvedAt:
        opts.resolvedDaysAgo != null ? new Date(Date.now() - opts.resolvedDaysAgo * DAY) : null,
      slaDueAt: new Date(Date.now() + DAY),
      duplicateOfId: opts.duplicateOfId ?? null,
    },
  })
}

const repeatRate = async (unitId: number) =>
  (await collectUnitSignals(unitId)).repeatComplaintRate as number

beforeAll(async () => {
  f = await build()
  const a = await prisma.complaintCategory.create({
    data: { code: 'TEST_POTHOLE', name: 'Potholes', departmentId: f.deepDept },
  })
  const b = await prisma.complaintCategory.create({
    data: { code: 'TEST_LIGHT', name: 'Street lights', departmentId: f.deepDept },
  })
  potholes = a.id
  lights = b.id
})

beforeEach(async () => {
  await prisma.riskFlag.deleteMany()
  await prisma.riskScore.deleteMany()
  await prisma.complaint.deleteMany()
})

describe('a wave of simultaneous reports is not a recurrence', () => {
  it('scores zero when nothing has been resolved yet', async () => {
    // Ten potholes reported in one week. The old definition called nine of
    // these ten a repeat and returned 0.9.
    for (let i = 0; i < 10; i++) {
      await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 5 })
    }
    expect(await repeatRate(f.sector1)).toBe(0)
  })

  it('does not climb as volume grows', async () => {
    for (let i = 0; i < 5; i++) {
      await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 5 })
    }
    const small = await repeatRate(f.sector1)

    for (let i = 0; i < 40; i++) {
      await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 5 })
    }
    const large = await repeatRate(f.sector1)

    // The old definition went from 0.8 to roughly 0.98 here purely on volume.
    expect(large).toBe(small)
  })
})

describe('an issue that comes back after a fix is a recurrence', () => {
  it('counts a complaint filed after an earlier one was resolved', async () => {
    await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 30, resolvedDaysAgo: 20 })
    await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 10 })

    // One of the two candidates came back after a fix.
    expect(await repeatRate(f.sector1)).toBeCloseTo(0.5, 5)
  })

  it('does not count one filed before the fix landed', async () => {
    // Both open at the same time, one later resolved. The second was already in
    // the queue when the first was fixed, so it is part of the same wave.
    await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 30, resolvedDaysAgo: 5 })
    await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 20 })

    expect(await repeatRate(f.sector1)).toBe(0)
  })

  it('keeps categories separate', async () => {
    await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 30, resolvedDaysAgo: 20 })
    await filed({ unitId: f.sector1, categoryId: lights, daysAgo: 10 })

    // A street light is not a returning pothole.
    expect(await repeatRate(f.sector1)).toBe(0)
  })

  it('keeps areas separate', async () => {
    await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 30, resolvedDaysAgo: 20 })
    await filed({ unitId: f.sector2, categoryId: potholes, daysAgo: 10 })

    expect(await repeatRate(f.sector2)).toBe(0)
    // The parent sees both, so from the zone's vantage the issue did return.
    expect(await repeatRate(f.zoneA)).toBeCloseTo(0.5, 5)
  })
})

describe('duplicates are corroboration, not recurrence', () => {
  it('excludes a complaint explicitly marked duplicate', async () => {
    const first = await filed({
      unitId: f.sector1,
      categoryId: potholes,
      daysAgo: 30,
      resolvedDaysAgo: 20,
    })
    await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 10 })
    await filed({
      unitId: f.sector1,
      categoryId: potholes,
      daysAgo: 10,
      duplicateOfId: first.id,
    })

    // Two candidates, one recurrence. The duplicate leaves both sides of the
    // ratio rather than inflating the numerator as it used to.
    expect(await repeatRate(f.sector1)).toBeCloseTo(0.5, 5)
  })

  it('cannot exceed 1.0', async () => {
    for (let i = 0; i < 3; i++) {
      await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 40, resolvedDaysAgo: 35 })
    }
    for (let i = 0; i < 3; i++) {
      await filed({ unitId: f.sector1, categoryId: potholes, daysAgo: 5 })
    }
    const rate = await repeatRate(f.sector1)
    expect(rate).toBeLessThanOrEqual(1)
    expect(rate).toBeGreaterThan(0)
  })
})

describe('an area with no categorised complaints', () => {
  it('reports zero rather than dividing by nothing', async () => {
    expect(await repeatRate(f.sector3)).toBe(0)
  })
})
