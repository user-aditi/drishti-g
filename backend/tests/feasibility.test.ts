/**
 * What may lawfully happen next, and who may do it.
 *
 * This is the set the autonomy gate renormalises confidence over in wave 4, so
 * an error here does not produce a wrong answer — it produces a *confidently*
 * wrong answer, with the gate's arithmetic dividing by a permitted set that was
 * never permitted. The three cases the buildbook names are pinned below, plus
 * the property that keeps the state machine navigable at all.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ComplaintStatus, Rank } from '@prisma/client'
import {
  feasibleActions,
  isTerminal,
  permittedActions,
  type FeasibilityTarget,
} from '../src/services/feasibility.js'
import { ALLOWED_TRANSITIONS } from '../src/services/gcce.js'
import { build, complaint, prisma, type Fixture } from './fixture.js'

let f: Fixture

beforeAll(async () => {
  f = await build()
})

beforeEach(async () => {
  await prisma.decision.deleteMany()
  await prisma.complaint.deleteMany()
})

function target(over: Partial<FeasibilityTarget> = {}): FeasibilityTarget {
  return {
    id: 1,
    status: ComplaintStatus.ASSIGNED,
    departmentId: f.deepDept,
    sectorId: null,
    orgUnitId: f.sector1,
    assignedOfficerId: f.sector1Officer,
    ...over,
  }
}

describe('the state machine sets the candidates', () => {
  it('offers exactly what the transition table allows', async () => {
    const actions = await feasibleActions(prisma, target({ status: ComplaintStatus.ASSIGNED }))
    expect(actions.map((a) => a.action).sort()).toEqual(
      [...ALLOWED_TRANSITIONS[ComplaintStatus.ASSIGNED]].sort(),
    )
  })

  /**
   * Without this a complaint could reach a status from which nothing is
   * possible and nothing is final — stuck, with no error anywhere to say so.
   */
  it('leaves every status either navigable or explicitly terminal', async () => {
    for (const status of Object.values(ComplaintStatus)) {
      const actions = await feasibleActions(prisma, target({ status }))
      expect(actions.length > 0 || isTerminal(status)).toBe(true)
    }
  })

  it('offers nothing at all from a terminal status', async () => {
    expect(await feasibleActions(prisma, target({ status: ComplaintStatus.CLOSED }))).toEqual([])
    expect(await feasibleActions(prisma, target({ status: ComplaintStatus.REJECTED }))).toEqual([])
  })
})

describe('rank', () => {
  /**
   * The oldest control in public administration: the officer who did the work
   * does not sign it off.
   */
  it('refuses to let a Section Officer close a complaint', async () => {
    const actions = await feasibleActions(
      prisma,
      target({ status: ComplaintStatus.RESOLVED }),
      { id: f.sector1Officer, rank: Rank.SECTION_OFFICER },
    )

    const close = actions.find((a) => a.action === ComplaintStatus.CLOSED)!
    expect(close.permitted).toBe(false)
    expect(close.blockedReason).toContain('Circle Officer')
  })

  it('allows a Circle Officer to close the same complaint', async () => {
    const actions = await feasibleActions(
      prisma,
      target({ status: ComplaintStatus.RESOLVED, orgUnitId: f.city, departmentId: f.deepDept }),
      { id: f.cityOfficer, rank: Rank.CIRCLE_OFFICER },
    )

    const close = actions.find((a) => a.action === ComplaintStatus.CLOSED)!
    expect(close.permitted).toBe(true)
    expect(close.blockedReason).toBeNull()
  })

  /**
   * Blocked actions are returned rather than hidden. An officer who cannot see
   * that closing exists learns nothing about how the authority works.
   */
  it('still describes an action it will not permit', async () => {
    const actions = await feasibleActions(
      prisma,
      target({ status: ComplaintStatus.RESOLVED }),
      { id: f.sector1Officer, rank: Rank.SECTION_OFFICER },
    )

    const close = actions.find((a) => a.action === ComplaintStatus.CLOSED)!
    expect(close.permittedBy).toContain('Close')
    expect(close.permittedBy).toContain('Circle Officer')
  })
})

describe('the world', () => {
  it('will not send a crew from a post nobody holds', async () => {
    const actions = await feasibleActions(
      prisma,
      target({ status: ComplaintStatus.ASSIGNED, assignedOfficerId: null }),
      { id: f.sector1Officer, rank: Rank.SECTION_OFFICER },
    )

    const dispatch = actions.find((a) => a.action === ComplaintStatus.IN_PROGRESS)!
    expect(dispatch.permitted).toBe(false)
    expect(dispatch.blockedReason).toContain('Nobody holds this complaint')
  })

  it('sends a crew once somebody holds it', async () => {
    const actions = await feasibleActions(
      prisma,
      target({ status: ComplaintStatus.ASSIGNED, assignedOfficerId: f.sector1Officer }),
      { id: f.sector1Officer, rank: Rank.SECTION_OFFICER },
    )

    const dispatch = actions.find((a) => a.action === ComplaintStatus.IN_PROGRESS)!
    expect(dispatch.permitted).toBe(true)
  })
})

describe('jurisdiction', () => {
  it('blocks every action on a complaint outside the ground you cover', async () => {
    const c = await complaint(f, { unitId: f.sector3, departmentId: f.deepDept })

    const actions = await feasibleActions(
      prisma,
      {
        id: c.id,
        status: ComplaintStatus.ASSIGNED,
        departmentId: f.deepDept,
        sectorId: null,
        orgUnitId: f.sector3,
        assignedOfficerId: null,
      },
      // Posted to Sector 1, under Zone A. Sector 3 sits under Zone B.
      { id: f.sector1Officer, rank: Rank.SECTION_OFFICER },
    )

    expect(actions.length).toBeGreaterThan(0)
    expect(actions.every((a) => !a.permitted)).toBe(true)
    expect(actions.some((a) => a.blockedReason?.includes('outside the ground'))).toBe(true)
  })
})

describe('what the gate consumes', () => {
  /**
   * Asked without an actor, this is the policy question alone — which is what
   * the autonomy gate needs, because the gate acts on nobody's behalf.
   */
  it('answers the policy question when nobody is asking', async () => {
    const permitted = await permittedActions(prisma, target({ status: ComplaintStatus.ASSIGNED }))
    expect(permitted).toEqual(ALLOWED_TRANSITIONS[ComplaintStatus.ASSIGNED])
  })

  it('narrows to what this actor may actually do', async () => {
    const permitted = await permittedActions(
      prisma,
      target({ status: ComplaintStatus.RESOLVED }),
      { id: f.sector1Officer, rank: Rank.SECTION_OFFICER },
    )
    expect(permitted).not.toContain(ComplaintStatus.CLOSED)
    expect(permitted).toContain(ComplaintStatus.IN_PROGRESS)
  })
})
