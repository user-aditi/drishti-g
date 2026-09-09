/**
 * Escalation — the mechanism that makes a missed deadline cost something.
 *
 * The guard tested here is not incidental. GRIE measures how often work misses
 * its deadline; a complaint that climbs without having missed one would corrupt
 * exactly that signal, so escalating something not yet overdue must be refused
 * at the function, not only filtered out by the sweep that usually calls it.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { escalateOne, runEscalationSweep } from '../src/services/escalation.js'
import { build, complaint, prisma, type Fixture } from './fixture.js'

let f: Fixture

beforeAll(async () => {
  f = await build()
})

beforeEach(async () => {
  await prisma.escalation.deleteMany()
  await prisma.complaintStatusHistory.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.auditEvent.deleteMany()
  await prisma.complaint.deleteMany()
})

describe('a single step', () => {
  it('moves an overdue complaint to its parent unit', async () => {
    const c = await complaint(f, {
      unitId: f.sector1,
      departmentId: f.deepDept,
      overdueHours: 6,
    })

    const result = await escalateOne(c.id)

    expect(result).not.toBeNull()
    expect(result!.fromUnitId).toBe(f.sector1)
    expect(result!.toUnitId).toBe(f.zoneA)

    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })
    expect(after.orgUnitId).toBe(f.zoneA)
    expect(after.escalationLevel).toBe(1)
  })

  it('hands the complaint to the officer posted above', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 6 })
    await escalateOne(c.id)
    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })
    expect(after.assignedOfficerId).toBe(f.zoneAOfficer)
  })

  it('resets the deadline to the NEW layer allowance, not the expired one', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 6 })
    await escalateOne(c.id)

    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })
    // Zone allows 72h in the fixture; the new deadline must be in the future
    // and roughly that far out.
    expect(after.slaDueAt!.getTime()).toBeGreaterThan(Date.now())
    const hours = (after.slaDueAt!.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(70)
    expect(hours).toBeLessThan(73)
  })

  it('raises priority, because it has already failed once below', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 6 })
    expect(c.priority).toBe('MEDIUM')
    await escalateOne(c.id)
    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })
    expect(after.priority).toBe('HIGH')
  })

  it('records the step as a unit-to-unit move, pointing upward', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 6 })
    await escalateOne(c.id)

    const [row] = await prisma.escalation.findMany({
      where: { complaintId: c.id },
      include: { fromUnit: true, toUnit: true },
    })
    expect(row!.fromUnit!.depth).toBeGreaterThan(row!.toUnit!.depth)
    expect(row!.hoursOverdue).toBeGreaterThanOrEqual(5)
  })

  it('notifies the officer who inherits it and writes an audit entry', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 6 })
    await escalateOne(c.id)

    const notified = await prisma.notification.count({ where: { userId: f.zoneAOfficer } })
    expect(notified).toBe(1)

    const audited = await prisma.auditEvent.count({
      where: { action: 'complaint.escalated', entityId: String(c.id) },
    })
    expect(audited).toBe(1)
  })
})

describe('the guards', () => {
  it('REFUSES a complaint that is not overdue', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })

    const result = await escalateOne(c.id)

    expect(result).toBeNull()
    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })
    expect(after.orgUnitId).toBe(f.sector1)
    expect(after.escalationLevel).toBe(0)
    expect(await prisma.escalation.count({ where: { complaintId: c.id } })).toBe(0)
  })

  it('refuses at the root, because there is nothing above the city', async () => {
    const c = await complaint(f, { unitId: f.city, departmentId: f.deepDept, overdueHours: 99 })
    expect(await escalateOne(c.id)).toBeNull()
  })

  it('refuses a complaint that is already closed', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 6 })
    await prisma.complaint.update({ where: { id: c.id }, data: { status: 'CLOSED' } })
    expect(await escalateOne(c.id)).toBeNull()
  })

  it('refuses rather than escalating into a vacancy', async () => {
    // Sector 3 sits under Zone B, where the shallow department has nobody.
    const c = await complaint(f, {
      unitId: f.sector3,
      departmentId: f.shallowDept,
      overdueHours: 6,
    })
    expect(await escalateOne(c.id)).toBeNull()

    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })
    expect(after.orgUnitId).toBe(f.sector3)
  })
})

describe('climbing the whole tree', () => {
  it('reaches the root in as many steps as the tree is deep, then stops', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 6 })
    const visited: number[] = []

    for (let step = 0; step < 5; step++) {
      const result = await escalateOne(c.id)
      if (!result) break
      visited.push(result.toUnitId)
      // Force it past the new deadline so the next step is legitimate.
      await prisma.complaint.update({
        where: { id: c.id },
        data: { slaDueAt: new Date(Date.now() - 3_600_000) },
      })
    }

    expect(visited).toEqual([f.zoneA, f.city])

    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })
    expect(after.orgUnitId).toBe(f.city)
    expect(await escalateOne(c.id)).toBeNull()
  })
})

describe('the sweep', () => {
  it('escalates only the overdue ones and leaves the rest alone', async () => {
    const late = await complaint(f, {
      unitId: f.sector1,
      departmentId: f.deepDept,
      overdueHours: 4,
      title: 'Late one',
    })
    const fine = await complaint(f, {
      unitId: f.sector1,
      departmentId: f.deepDept,
      title: 'Healthy one',
    })

    const { escalated } = await runEscalationSweep()

    expect(escalated.map((e) => e.complaintId)).toEqual([late.id])

    const stillHome = await prisma.complaint.findUniqueOrThrow({ where: { id: fine.id } })
    expect(stillHome.orgUnitId).toBe(f.sector1)
    expect(stillHome.escalationLevel).toBe(0)
  })

  it('does not consider complaints already at the root', async () => {
    await complaint(f, { unitId: f.city, departmentId: f.deepDept, overdueHours: 50 })
    const { escalated } = await runEscalationSweep()
    expect(escalated).toHaveLength(0)
  })
})
