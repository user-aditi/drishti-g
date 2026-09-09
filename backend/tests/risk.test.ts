/**
 * GRIE scoring over the org tree.
 *
 * The property worth pinning: an area's saturation threshold scales with how
 * much ground it covers. With one fixed cap, the open-complaint factor was
 * inert at the top of the tree (a city never reaches 25 open complaints' worth
 * of "full") and hair-trigger at the bottom. A zone must not be judged by a
 * sector's threshold.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RiskEntityType } from '@prisma/client'
import { scoreEntity } from '../src/services/grie.js'
import {
  SECTOR_SATURATION,
  collectUnitSignals,
  recomputeEntity,
  unitLoadCap,
} from '../src/services/riskSignals.js'
import { build, complaint, prisma, type Fixture } from './fixture.js'

let f: Fixture

beforeAll(async () => {
  f = await build()
})

beforeEach(async () => {
  await prisma.riskFlag.deleteMany()
  await prisma.riskScore.deleteMany()
  await prisma.complaint.deleteMany()
})

describe('the saturation threshold scales with the ground covered', () => {
  it('is one sector-worth at the ground floor', async () => {
    expect(await unitLoadCap(f.sector1)).toBe(SECTOR_SATURATION)
  })

  it('grows with the number of ground-floor units beneath', async () => {
    // Zone A holds two sectors, Zone B holds one, the city holds all three.
    expect(await unitLoadCap(f.zoneA)).toBe(SECTOR_SATURATION * 2)
    expect(await unitLoadCap(f.zoneB)).toBe(SECTOR_SATURATION * 1)
    expect(await unitLoadCap(f.city)).toBe(SECTOR_SATURATION * 3)
  })

  it('never returns zero, so the curve cannot divide by nothing', async () => {
    await prisma.orgUnit.updateMany({ where: { isLeaf: true }, data: { isActive: false } })
    expect(await unitLoadCap(f.city)).toBeGreaterThan(0)
    await prisma.orgUnit.updateMany({ where: { isLeaf: true }, data: { isActive: true } })
  })
})

describe('signals cover the whole subtree', () => {
  it('counts a child unit complaint against its parent', async () => {
    await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })

    const sector = await collectUnitSignals(f.sector1)
    const zone = await collectUnitSignals(f.zoneA)

    expect(sector.openComplaintLoad).toBe(1)
    expect(zone.openComplaintLoad).toBe(2)
  })

  it('does not count a sibling subtree', async () => {
    await complaint(f, { unitId: f.sector3, departmentId: f.deepDept })
    const zoneA = await collectUnitSignals(f.zoneA)
    expect(zoneA.openComplaintLoad).toBe(0)
  })
})

describe('scoring is comparable across depths', () => {
  it('does not max out a parent just because it aggregates its children', async () => {
    // Half of each sector's saturation: at the cap both sides clamp to 1.0 and
    // the comparison would prove nothing.
    const half = Math.floor(SECTOR_SATURATION / 2)
    for (let i = 0; i < half; i++) {
      await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
      await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })
    }

    const sectorSignals = await collectUnitSignals(f.sector1)
    const zoneSignals = await collectUnitSignals(f.zoneA)

    const sectorScore = scoreEntity(
      RiskEntityType.ORG_UNIT,
      f.sector1,
      sectorSignals,
      undefined,
      await unitLoadCap(f.sector1),
    )
    const zoneScore = scoreEntity(
      RiskEntityType.ORG_UNIT,
      f.zoneA,
      zoneSignals,
      undefined,
      await unitLoadCap(f.zoneA),
    )

    // Both are equally saturated for their size, so the load factor should read
    // the same at both depths rather than the parent looking twice as bad.
    const load = (s: typeof sectorScore) =>
      s.factors.find((x) => x.factor === 'openComplaintLoad')!.normalised
    expect(load(zoneScore)).toBeCloseTo(load(sectorScore), 5)
  })

  it('would over-penalise the parent if the cap were not scaled', async () => {
    const half = Math.floor(SECTOR_SATURATION / 2)
    for (let i = 0; i < half; i++) {
      await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
      await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })
    }
    const zoneSignals = await collectUnitSignals(f.zoneA)

    const scaled = scoreEntity(
      RiskEntityType.ORG_UNIT,
      f.zoneA,
      zoneSignals,
      undefined,
      await unitLoadCap(f.zoneA),
    )
    const unscaled = scoreEntity(
      RiskEntityType.ORG_UNIT,
      f.zoneA,
      zoneSignals,
      undefined,
      SECTOR_SATURATION,
    )

    expect(unscaled.score).toBeGreaterThan(scaled.score)
  })
})

describe('recomputing a unit', () => {
  it('stores a score against ORG_UNIT and labels it by its own layer', async () => {
    await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 30 })
    await recomputeEntity(RiskEntityType.ORG_UNIT, f.sector1)

    const stored = await prisma.riskScore.findFirst({
      where: { entityType: RiskEntityType.ORG_UNIT, entityId: f.sector1 },
      orderBy: { computedAt: 'desc' },
    })
    expect(stored).not.toBeNull()
    expect(stored!.score).toBeGreaterThan(0)
    expect(['LOW', 'MODERATE', 'HIGH', 'SEVERE']).toContain(stored!.band)
  })

  it('is append-only, so a score history can be replayed', async () => {
    await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await recomputeEntity(RiskEntityType.ORG_UNIT, f.sector1)
    await recomputeEntity(RiskEntityType.ORG_UNIT, f.sector1)

    const count = await prisma.riskScore.count({
      where: { entityType: RiskEntityType.ORG_UNIT, entityId: f.sector1 },
    })
    expect(count).toBe(2)
  })

  it('every factor carries the sentence that produced it', async () => {
    await complaint(f, { unitId: f.sector1, departmentId: f.deepDept, overdueHours: 40 })
    const result = scoreEntity(
      RiskEntityType.ORG_UNIT,
      f.sector1,
      await collectUnitSignals(f.sector1),
      undefined,
      await unitLoadCap(f.sector1),
    )
    // Interpretability is the point of the baseline: a score nobody can read
    // is not the control arm the paper needs.
    for (const factor of result.factors) {
      expect(typeof factor.explanation).toBe('string')
      expect(typeof factor.factor).toBe('string')
      expect(factor.explanation.length).toBeGreaterThan(0)
    }
  })
})
