/**
 * The decision record.
 *
 * Two properties carry everything downstream. First, a decision and the action
 * it produced land together or not at all — otherwise the table can claim the
 * engine chose something it never acted on, and W3 trains on a lie. Second, a
 * correction settles the decision the person was actually shown, not a fresher
 * one written moments later by the re-route their correction triggered.
 *
 * The second is the subtle one, and it is the reason `resolve` takes the newest
 * *pending* row rather than all rows of that kind.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DecisionKind, DecisionOutcome } from '@prisma/client'
import * as decisions from '../src/services/decisions.js'
import { keywordConfidence, rankCategories } from '../src/services/gcce.js'
import { build, complaint, prisma, type Fixture } from './fixture.js'

let f: Fixture

beforeAll(async () => {
  f = await build()
})

beforeEach(async () => {
  await prisma.decision.deleteMany()
  await prisma.complaint.deleteMany()
})

describe('ranking categories', () => {
  const categories = [
    { id: 1, name: 'Garbage', keywords: 'garbage,kooda,waste,bin' },
    { id: 2, name: 'Streetlight', keywords: 'streetlight,light,dark' },
    { id: 3, name: 'Drain', keywords: 'drain,nali,sewage' },
  ]

  it('returns every category that matched, best first', () => {
    const ranked = rankCategories('the kooda bin near the streetlight', categories)
    expect(ranked.map((c) => c.name)).toEqual(['Garbage', 'Streetlight'])
    expect(ranked[0]!.hits).toBe(2)
    expect(ranked[1]!.hits).toBe(1)
  })

  it('returns nothing when nothing matches', () => {
    expect(rankCategories('a pleasant afternoon', categories)).toEqual([])
  })

  /**
   * An unstable ranking would make the stored alternatives irreproducible for
   * the same complaint text, which quietly breaks the training set.
   */
  it('breaks ties deterministically', () => {
    const a = rankCategories('garbage drain', categories)
    const b = rankCategories('garbage drain', categories)
    expect(a).toEqual(b)
    expect(a[0]!.id).toBeLessThan(a[1]!.id)
  })

  it('scores confidence as the winner\'s share of all matched keywords', () => {
    // Two hits for Garbage, one for Streetlight: 2/3.
    const ranked = rankCategories('kooda bin near the streetlight', categories)
    expect(keywordConfidence(ranked)).toBeCloseTo(2 / 3, 5)

    // Nothing else matched at all.
    expect(keywordConfidence(rankCategories('kooda', categories))).toBe(1)
    expect(keywordConfidence([])).toBeNull()
  })
})

describe('recording a decision', () => {
  it('keeps the alternatives and the confidence alongside the choice', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })

    await decisions.record(prisma, {
      kind: DecisionKind.CATEGORY,
      complaintId: c.id,
      chosen: '7',
      alternatives: [
        { value: '7', label: 'Garbage', score: 3 },
        { value: '9', label: 'Drain', score: 1 },
      ],
      confidence: 0.75,
      reasons: ['Identified as "Garbage" from 3 keywords.'],
    })

    const stored = await prisma.decision.findFirstOrThrow()
    expect(stored.chosen).toBe('7')
    expect(stored.confidence).toBe(0.75)
    expect(stored.outcome).toBe(DecisionOutcome.PENDING)
    expect(stored.resolvedAt).toBeNull()
    expect(stored.alternatives).toHaveLength(2)
  })

  /**
   * An empty list is a fact about the engine — `findOwnerFor` walks up the tree
   * and returns the first officer it meets, weighing nobody. Fabricating
   * runners-up to fill the column would put invented labels into W3's training
   * data, which is worse than an honest gap.
   */
  it('stores an empty alternatives list rather than inventing rivals', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })

    await decisions.record(prisma, {
      kind: DecisionKind.ROUTE,
      complaintId: c.id,
      chosen: String(f.sector1Officer),
      reasons: ['Assigned to the officer for this area.'],
    })

    const stored = await prisma.decision.findFirstOrThrow()
    expect(stored.alternatives).toEqual([])
    expect(stored.confidence).toBeNull()
  })

  it('stamps resolvedAt when a decision is born already settled', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })

    await decisions.record(prisma, {
      kind: DecisionKind.NEXT_ACTION,
      complaintId: c.id,
      chosen: 'ASSIGNED',
      reasons: ['Acted on without review.'],
      outcome: DecisionOutcome.AUTO_EXECUTED,
      source: 'autonomy',
    })

    const stored = await prisma.decision.findFirstOrThrow()
    expect(stored.outcome).toBe(DecisionOutcome.AUTO_EXECUTED)
    expect(stored.resolvedAt).not.toBeNull()
  })
})

describe('resolving a decision', () => {
  async function record(complaintId: number, chosen: string) {
    return decisions.record(prisma, {
      kind: DecisionKind.CATEGORY,
      complaintId,
      chosen,
      reasons: ['engine reason'],
    })
  }

  it('marks the decision overridden and records what it became', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await record(c.id, '7')

    await decisions.resolve(prisma, {
      complaintId: c.id,
      kind: DecisionKind.CATEGORY,
      outcome: DecisionOutcome.OVERRIDDEN,
      overriddenTo: '9',
      overriddenById: f.citizen,
      overrideReason: 'Citizen corrected the category after filing',
    })

    const stored = await prisma.decision.findFirstOrThrow()
    expect(stored.outcome).toBe(DecisionOutcome.OVERRIDDEN)
    expect(stored.overriddenTo).toBe('9')
    expect(stored.overriddenById).toBe(f.citizen)
    expect(stored.resolvedAt).not.toBeNull()
  })

  /**
   * The ordering property. A correction triggers a re-route, which writes a
   * fresh CATEGORY decision; settling the whole set would mark that new one as
   * judged by a citizen who never saw it.
   */
  it('settles only the newest pending decision, leaving a later one alone', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    const first = await record(c.id, '7')
    const second = await record(c.id, '8')

    await decisions.resolve(prisma, {
      complaintId: c.id,
      kind: DecisionKind.CATEGORY,
      outcome: DecisionOutcome.CONFIRMED,
    })

    const rows = await prisma.decision.findMany({ orderBy: { id: 'asc' } })
    expect(rows.find((r) => r.id === first.id)!.outcome).toBe(DecisionOutcome.PENDING)
    expect(rows.find((r) => r.id === second.id)!.outcome).toBe(DecisionOutcome.CONFIRMED)
  })

  it('does nothing, without throwing, when there is no pending decision', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    const result = await decisions.resolve(prisma, {
      complaintId: c.id,
      kind: DecisionKind.CATEGORY,
      outcome: DecisionOutcome.CONFIRMED,
    })
    expect(result).toBeNull()
  })

  it('does not settle a decision of a different kind', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await decisions.record(prisma, {
      kind: DecisionKind.PRIORITY,
      complaintId: c.id,
      chosen: 'HIGH',
      reasons: ['busy sector'],
    })

    const result = await decisions.resolve(prisma, {
      complaintId: c.id,
      kind: DecisionKind.CATEGORY,
      outcome: DecisionOutcome.OVERRIDDEN,
    })

    expect(result).toBeNull()
    const stored = await prisma.decision.findFirstOrThrow()
    expect(stored.outcome).toBe(DecisionOutcome.PENDING)
  })
})

describe('agreement rates', () => {
  /**
   * Silence is not consent. Most decisions are never reviewed, and counting
   * pending rows as agreement would report a classifier as near-perfect
   * precisely because nobody was looking at it.
   */
  it('excludes unreviewed decisions from the denominator', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })

    for (const chosen of ['1', '2', '3', '4']) {
      await decisions.record(prisma, {
        kind: DecisionKind.CATEGORY,
        complaintId: c.id,
        chosen,
        reasons: ['r'],
      })
    }

    // One confirmed, one overridden, two left untouched.
    await decisions.resolve(prisma, {
      complaintId: c.id,
      kind: DecisionKind.CATEGORY,
      outcome: DecisionOutcome.CONFIRMED,
    })
    await decisions.resolve(prisma, {
      complaintId: c.id,
      kind: DecisionKind.CATEGORY,
      outcome: DecisionOutcome.OVERRIDDEN,
      overriddenTo: '9',
    })

    const [summary] = await decisions.agreementByKind(prisma)
    expect(summary!.kind).toBe(DecisionKind.CATEGORY)
    expect(summary!.reviewed).toBe(2)
    expect(summary!.pending).toBe(2)
    expect(summary!.total).toBe(4)
    expect(summary!.agreementRate).toBe(0.5)
  })

  it('reports no rate at all when nothing has been reviewed', async () => {
    const c = await complaint(f, { unitId: f.sector1, departmentId: f.deepDept })
    await decisions.record(prisma, {
      kind: DecisionKind.ROUTE,
      complaintId: c.id,
      chosen: '1',
      reasons: ['r'],
    })

    const [summary] = await decisions.agreementByKind(prisma)
    expect(summary!.agreementRate).toBeNull()
  })
})
