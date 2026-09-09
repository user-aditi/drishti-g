/**
 * The org tree — navigation, scope, and per-department depth.
 *
 * Two real bugs motivate most of this file: dispatch was once keyed to the
 * tree's leaves rather than a department's own deepest layer, which left every
 * short department unable to dispatch anywhere; and scope was briefly readable
 * across siblings. Both are asserted here directly.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as org from '../src/services/orgTree.js'
import { departmentsInScope, hasJurisdiction } from '../src/services/hierarchy.js'
import { build, complaint, prisma, type Fixture } from './fixture.js'

let f: Fixture

beforeAll(async () => {
  f = await build()
})

describe('navigation', () => {
  it('finds the root and knows its depth', async () => {
    const root = await org.getRoot(prisma)
    expect(root?.id).toBe(f.city)
    expect(root?.depth).toBe(0)
  })

  it('lists ancestors root-first, excluding the unit itself', async () => {
    const sector = await prisma.orgUnit.findUniqueOrThrow({ where: { id: f.sector1 } })
    const ancestors = await org.getAncestors(prisma, sector)
    expect(ancestors.map((a) => a.id)).toEqual([f.city, f.zoneA])
  })

  it('builds a breadcrumb from the city down to the unit', async () => {
    const crumbs = await org.breadcrumb(prisma, f.sector1)
    expect(crumbs.map((c) => c.name)).toEqual(['Testville', 'Zone A', 'Sector 1'])
  })

  it('returns the subtree including the unit itself', async () => {
    const ids = await org.getSubtreeIds(prisma, f.zoneA)
    expect(new Set(ids)).toEqual(new Set([f.zoneA, f.sector1, f.sector2]))
  })

  it('does not leak a sibling subtree', async () => {
    const ids = await org.getSubtreeIds(prisma, f.zoneA)
    expect(ids).not.toContain(f.zoneB)
    expect(ids).not.toContain(f.sector3)
  })

  it('escalates to the parent, and stops at the root', async () => {
    expect((await org.parentOf(prisma, f.sector1))?.id).toBe(f.zoneA)
    expect((await org.parentOf(prisma, f.zoneA))?.id).toBe(f.city)
    expect(await org.parentOf(prisma, f.city)).toBeNull()
  })
})

describe('scope is position, not seniority', () => {
  it('gives a sector officer only their own unit', async () => {
    const scope = await org.unitsInScope(prisma, f.sector1Officer)
    expect(scope).toEqual([f.sector1])
  })

  it('gives a zone officer their zone and its sectors', async () => {
    const scope = await org.unitsInScope(prisma, f.zoneAOfficer)
    expect(new Set(scope)).toEqual(new Set([f.zoneA, f.sector1, f.sector2]))
  })

  it('gives someone posted at the root no limit at all', async () => {
    expect(await org.unitsInScope(prisma, f.cityOfficer)).toBeNull()
  })

  it('refuses a zone officer access to a sibling zone and its sectors', async () => {
    expect(await org.hasScope(prisma, f.zoneAOfficer, f.zoneB)).toBe(false)
    expect(await org.hasScope(prisma, f.zoneAOfficer, f.sector3)).toBe(false)
  })

  it('refuses a sector officer access upward', async () => {
    expect(await org.hasScope(prisma, f.sector1Officer, f.zoneA)).toBe(false)
    expect(await org.hasScope(prisma, f.sector1Officer, f.city)).toBe(false)
  })

  it('allows a root officer everywhere', async () => {
    for (const unit of [f.city, f.zoneA, f.zoneB, f.sector3]) {
      expect(await org.hasScope(prisma, f.cityOfficer, unit)).toBe(true)
    }
  })
})

describe('a department operates to its own depth', () => {
  it('reports the deepest configured layer', async () => {
    expect(await org.departmentLeafDepth(prisma, f.deepDept)).toBe(2)
    expect(await org.departmentLeafDepth(prisma, f.shallowDept)).toBe(1)
  })

  it('treats the sector as the ground floor for a full-depth department', async () => {
    expect(await org.isDepartmentLeaf(prisma, { unitId: f.sector1, departmentId: f.deepDept })).toBe(true)
    expect(await org.isDepartmentLeaf(prisma, { unitId: f.zoneA, departmentId: f.deepDept })).toBe(false)
  })

  it('treats the ZONE as the ground floor for a shallow department', async () => {
    // The regression that matters: a zone has children, so a leaf-of-the-tree
    // test would call this false and the department could never dispatch.
    expect(await org.isDepartmentLeaf(prisma, { unitId: f.zoneA, departmentId: f.shallowDept })).toBe(true)
    expect(await org.isDepartmentLeaf(prisma, { unitId: f.sector1, departmentId: f.shallowDept })).toBe(false)
  })

  it('lets a shallow department dispatch from a unit that has children', async () => {
    expect(await org.canDispatchFrom(prisma, { unitId: f.zoneA, departmentId: f.shallowDept })).toBe(true)
  })

  it('never lets a parent dispatch for a full-depth department', async () => {
    expect(await org.canDispatchFrom(prisma, { unitId: f.city, departmentId: f.deepDept })).toBe(false)
    expect(await org.canDispatchFrom(prisma, { unitId: f.zoneA, departmentId: f.deepDept })).toBe(false)
    expect(await org.canDispatchFrom(prisma, { unitId: f.sector1, departmentId: f.deepDept })).toBe(true)
  })

  it('never dispatches from below a shallow department reach', async () => {
    expect(await org.canDispatchFrom(prisma, { unitId: f.sector1, departmentId: f.shallowDept })).toBe(false)
  })

  it('reads the SLA of the layer the unit sits at', async () => {
    expect(await org.slaHoursFor(prisma, { unitId: f.sector1, departmentId: f.deepDept })).toBe(24)
    expect(await org.slaHoursFor(prisma, { unitId: f.zoneA, departmentId: f.deepDept })).toBe(72)
    expect(await org.slaHoursFor(prisma, { unitId: f.city, departmentId: f.deepDept })).toBe(168)
  })

  it('returns ground-floor units for the department, not the tree', async () => {
    const deep = await org.getLeavesBelow(prisma, f.city, f.deepDept)
    expect(deep.map((u) => u.depth)).toEqual([2, 2, 2])

    const shallow = await org.getLeavesBelow(prisma, f.city, f.shallowDept)
    expect(shallow.map((u) => u.depth)).toEqual([1, 1])
  })

  it('refuses to dispatch from an inactive unit', async () => {
    await prisma.orgUnit.update({ where: { id: f.sector2 }, data: { isActive: false } })
    expect(await org.canDispatchFrom(prisma, { unitId: f.sector2, departmentId: f.deepDept })).toBe(false)
    await prisma.orgUnit.update({ where: { id: f.sector2 }, data: { isActive: true } })
  })
})

describe('rollups', () => {
  it('sums a subtree, and the parent equals the sum of its children', async () => {
    await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await complaint(f, { unitId: f.sector2, departmentId: f.deepDept })
    await complaint(f, { unitId: f.sector3, departmentId: f.deepDept })

    const s1 = await org.rollup(prisma, f.sector1)
    const s2 = await org.rollup(prisma, f.sector2)
    const zone = await org.rollup(prisma, f.zoneA)
    const city = await org.rollup(prisma, f.city)

    expect(s1.open).toBe(2)
    expect(s2.open).toBe(1)
    expect(zone.open).toBe(s1.open + s2.open)
    expect(city.open).toBe(4)
  })

  it('counts overdue work separately from open work', async () => {
    await complaint(f, { unitId: f.sector2, departmentId: f.deepDept, overdueHours: 5 })
    const s2 = await org.rollup(prisma, f.sector2)
    expect(s2.open).toBe(2)
    expect(s2.overdue).toBe(1)
  })

  it('filters by department when asked', async () => {
    await complaint(f, { unitId: f.sector1, departmentId: f.shallowDept })
    const all = await org.rollup(prisma, f.sector1)
    const deepOnly = await org.rollup(prisma, f.sector1, f.deepDept)
    expect(all.open).toBeGreaterThan(deepOnly.open)
  })
})

describe('routing', () => {
  it('finds the officer posted at the unit', async () => {
    const owner = await org.findOwnerFor(prisma, { unitId: f.sector1, departmentId: f.deepDept })
    expect(owner?.userId).toBe(f.sector1Officer)
    expect(owner?.unitId).toBe(f.sector1)
  })

  it('walks UP when the post is vacant rather than leaving it unowned', async () => {
    // Sector 2 has nobody posted; the zone above does.
    const owner = await org.findOwnerFor(prisma, { unitId: f.sector2, departmentId: f.deepDept })
    expect(owner?.userId).toBe(f.zoneAOfficer)
    expect(owner?.unitId).toBe(f.zoneA)
  })

  it('returns nobody when the whole chain is vacant for that department', async () => {
    const owner = await org.findOwnerFor(prisma, { unitId: f.sector3, departmentId: f.shallowDept })
    expect(owner).toBeNull()
  })
})

describe('shaping the tree', () => {
  it('maintains depth, path and the parent leaf flag when adding a unit', async () => {
    const created = await org.createUnit(prisma, {
      parentId: f.sector3,
      code: 'BLOCK-1',
      name: 'Block 1',
      kindLabel: 'Block',
    })

    expect(created.depth).toBe(3)
    expect(created.path.endsWith(`/${created.id}/`)).toBe(true)
    expect(created.path.startsWith('/')).toBe(true)

    const parent = await prisma.orgUnit.findUniqueOrThrow({ where: { id: f.sector3 } })
    expect(parent.isLeaf).toBe(false)

    // And it is genuinely inside the parent's subtree.
    expect(await org.getSubtreeIds(prisma, f.sector3)).toContain(created.id)

    await prisma.orgUnit.delete({ where: { id: created.id } })
    await prisma.orgUnit.update({ where: { id: f.sector3 }, data: { isLeaf: true } })
  })

  it('refuses removal while anything still points at the unit', async () => {
    const check = await org.describeRemoval(prisma, f.sector1)
    expect(check.canRemove).toBe(false)
    expect(check.blockers.join(' ')).toMatch(/complaint/)
  })

  it('allows removal of a genuinely empty unit', async () => {
    const empty = await org.createUnit(prisma, {
      parentId: f.zoneB,
      code: 'EMPTY-1',
      name: 'Empty Sector',
      kindLabel: 'Sector',
    })
    const check = await org.describeRemoval(prisma, empty.id)
    expect(check.canRemove).toBe(true)
    expect(check.blockers).toEqual([])
    await prisma.orgUnit.delete({ where: { id: empty.id } })
  })
})

describe('a posting always resolves to a unit', () => {
    /**
     * The bug this guards: postings were being written with a null orgUnitId,
     * which produced an appointment that routed nothing, appeared in nobody's
     * scope and could not be escalated to. It looked like a working officer and
     * behaved like a vacancy.
     */
    it('accepts an explicit unit', async () => {
        expect(await org.resolveUnitForPosting(prisma, { orgUnitId: f.sector1 })).toBe(f.sector1)
    })

    it('falls back to the root when nothing is specified', async () => {
        expect(await org.resolveUnitForPosting(prisma, {})).toBe(f.city)
    })

    it('refuses an inactive unit rather than posting someone nowhere', async () => {
        await prisma.orgUnit.update({ where: { id: f.sector2 }, data: { isActive: false } })
        expect(await org.resolveUnitForPosting(prisma, { orgUnitId: f.sector2 })).toBeNull()
        await prisma.orgUnit.update({ where: { id: f.sector2 }, data: { isActive: true } })
    })

    it('refuses a unit that does not exist', async () => {
        expect(await org.resolveUnitForPosting(prisma, { orgUnitId: 999_999 })).toBeNull()
    })

    it('makes a resolved posting visible to scope and routing', async () => {
        const user = await prisma.user.create({
            data: {
                email: `late-appointment-${Date.now()}@test.local`,
                fullName: 'Newly Appointed',
                hashedPassword: 'test-not-a-real-hash',
                role: 'OFFICER',
                rank: 'SECTION_OFFICER',
            },
        })
        const unitId = await org.resolveUnitForPosting(prisma, { orgUnitId: f.sector2 })
        expect(unitId).not.toBeNull()

        await prisma.posting.create({
            data: {
                userId: user.id,
                departmentId: f.deepDept,
                orgUnitId: unitId,
                rank: 'SECTION_OFFICER',
                level: 'SECTOR',
                designationTitle: 'Newly Appointed',
            },
        })

        // They can see their patch...
        expect(await org.unitsInScope(prisma, user.id)).toEqual([f.sector2])
        // ...and work actually routes to them.
        const owner = await org.findOwnerFor(prisma, {
            unitId: f.sector2,
            departmentId: f.deepDept,
        })
        expect(owner?.userId).toBe(user.id)

        await prisma.posting.deleteMany({ where: { userId: user.id } })
        await prisma.user.delete({ where: { id: user.id } })
    })
})

describe('department scope is the posting, not the position', () => {
    /**
     * The regression this guards: "posted at the root" was briefly treated as
     * "sees every department", which silently let a General Manager read
     * another department's complaints. Running one department city-wide and
     * running the whole authority are different jobs.
     */
    it('limits a department head to their own department, even at the root', async () => {
        const gm = await prisma.user.create({
            data: {
                email: `gm-${Date.now()}@test.local`,
                fullName: 'Department Head',
                hashedPassword: 'test-not-a-real-hash',
                role: 'OFFICER',
                rank: 'HOD',
            },
        })
        await prisma.posting.create({
            data: {
                userId: gm.id,
                departmentId: f.deepDept,
                orgUnitId: f.city,
                rank: 'HOD',
                level: 'AUTHORITY',
            },
        })

        // Whole city geographically...
        expect(await org.unitsInScope(prisma, gm.id)).toBeNull()
        // ...but one department only.
        expect(await departmentsInScope(prisma, gm.id)).toEqual([f.deepDept])
        expect(
            await hasJurisdiction(
                prisma,
                { id: gm.id, rank: 'HOD' },
                { departmentId: f.shallowDept, orgUnitId: f.sector1 },
            ),
        ).toBe(false)

        await prisma.posting.deleteMany({ where: { userId: gm.id } })
        await prisma.user.delete({ where: { id: gm.id } })
    })

    it('gives a posting with no department every department', async () => {
        const ceo = await prisma.user.create({
            data: {
                email: `ceo-${Date.now()}@test.local`,
                fullName: 'Chief Executive',
                hashedPassword: 'test-not-a-real-hash',
                role: 'OFFICER',
                rank: 'CEO',
            },
        })
        await prisma.posting.create({
            data: { userId: ceo.id, orgUnitId: f.city, rank: 'CEO', level: 'AUTHORITY' },
        })

        expect(await departmentsInScope(prisma, ceo.id)).toBeNull()
        expect(
            await hasJurisdiction(
                prisma,
                { id: ceo.id, rank: 'CEO' },
                { departmentId: f.shallowDept, orgUnitId: f.sector3 },
            ),
        ).toBe(true)

        await prisma.posting.deleteMany({ where: { userId: ceo.id } })
        await prisma.user.delete({ where: { id: ceo.id } })
    })

    it('refuses an officer acting outside their own subtree', async () => {
        expect(
            await hasJurisdiction(
                prisma,
                { id: f.zoneAOfficer, rank: 'CIRCLE_OFFICER' },
                { departmentId: f.deepDept, orgUnitId: f.sector3 },
            ),
        ).toBe(false)
        expect(
            await hasJurisdiction(
                prisma,
                { id: f.zoneAOfficer, rank: 'CIRCLE_OFFICER' },
                { departmentId: f.deepDept, orgUnitId: f.sector1 },
            ),
        ).toBe(true)
    })
})
