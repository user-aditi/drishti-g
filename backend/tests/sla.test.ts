/**
 * The SLA estimator, and the promise it makes on the product's behalf.
 *
 * Two properties matter here and only one of them is arithmetic.
 *
 * The arithmetic: back off from the specific bucket to the general one, and
 * never return nothing — GCCE cannot route a complaint without setting a
 * deadline, so a null would become a complaint carrying no promise at all.
 *
 * The other: **the wording must not outrun the evidence.** The service returns
 * a `basis` saying which bucket answered, and `describeSla` uses it to decide
 * whether the sentence may say "in this area". Claiming sector-specific
 * knowledge from a city-wide average would be a small lie told to every citizen
 * who files a complaint, which is a large one.
 *
 * These run without a database and without a trained spec: `estimateSla` falls
 * back to the seeded hours, which is exactly the path a fresh deployment takes.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeSla, estimateSla, modelInfo } from '../src/services/sla.js'

const SPEC = path.resolve(process.cwd(), 'data/sla-spec.json')
const trained = existsSync(SPEC)

describe('there is always a deadline', () => {
  it('falls back to the seeded hours when nothing has been learned', () => {
    const estimate = estimateSla({ categoryId: 999999, orgUnitId: 999999, priority: 'LOW' }, 72)
    expect(estimate.basis).toBe('default')
    expect(estimate.p90).toBe(72)
    expect(estimate.p50).toBe(72)
    expect(estimate.support).toBe(0)
  })

  it('handles a complaint with no unit resolved yet', () => {
    const estimate = estimateSla({ categoryId: 1, orgUnitId: null, priority: 'MEDIUM' }, 48)
    expect(estimate.p90).toBeGreaterThan(0)
  })

  it('never returns a p90 below its p50', () => {
    for (const priority of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
      for (const categoryId of [1, 2, 3, 4, 5]) {
        const estimate = estimateSla({ categoryId, orgUnitId: 13, priority }, 72)
        expect(estimate.p90, `${categoryId}/${priority}`).toBeGreaterThanOrEqual(estimate.p50)
      }
    }
  })
})

describe('the wording matches the evidence', () => {
  it('claims area knowledge only when the estimate is about that area', () => {
    expect(describeSla({ p50: 24, p90: 72, basis: 'unit', support: 40 })).toContain('in this area')
    expect(describeSla({ p50: 24, p90: 72, basis: 'unit+priority', support: 40 })).toContain(
      'in this area',
    )
  })

  it('does not claim area knowledge from a category-wide average', () => {
    const sentence = describeSla({ p50: 24, p90: 72, basis: 'category', support: 400 })
    expect(sentence).not.toContain('in this area')
    expect(sentence).toContain('this kind of complaint')
  })

  it('makes an aim rather than an observation when nothing was learned', () => {
    const sentence = describeSla({ p50: 72, p90: 72, basis: 'default', support: 0 })
    expect(sentence).not.toContain('Usually')
    expect(sentence).toContain('aim')
  })

  /**
   * "Usually 51.4 hours" is precision nobody asked for and nobody believes.
   * Below a day it stays in hours, because "usually 0 days" is worse.
   */
  it('rounds to units a person would use', () => {
    expect(describeSla({ p50: 51.4, p90: 96.2, basis: 'unit', support: 40 })).toBe(
      'Usually 2 days to 4 days in this area.',
    )
    expect(describeSla({ p50: 3.2, p90: 7.8, basis: 'unit', support: 40 })).toBe(
      'Usually 3 hours to 8 hours in this area.',
    )
  })

  it('does not say "2 days to 2 days" when the range collapses', () => {
    expect(describeSla({ p50: 48, p90: 50, basis: 'unit', support: 40 })).toBe(
      'Usually 2 days in this area.',
    )
  })

  it('says "1 day" and "1 hour", not "1 days"', () => {
    expect(describeSla({ p50: 24, p90: 24, basis: 'unit', support: 12 })).toContain('1 day')
    expect(describeSla({ p50: 1, p90: 1, basis: 'unit', support: 12 })).toContain('1 hour')
  })
})

const suite = trained ? describe : describe.skip

suite('against the trained spec', () => {
  it('reports what it was trained on', () => {
    const info = modelInfo()
    expect(info).not.toBeNull()
    expect(info!.trainedOn).toBeGreaterThan(0)
    expect(info!.minSupport).toBeGreaterThanOrEqual(1)
  })

  /**
   * A learned estimate must beat the fallback it was given, or the training
   * pipeline is running and changing nothing — the failure mode where a model
   * ships, looks busy, and every answer is still the seeded constant.
   */
  it('returns learned buckets rather than the fallback for common categories', () => {
    const learned = [1, 2, 3, 4, 5]
      .map((categoryId) => estimateSla({ categoryId, orgUnitId: null, priority: 'MEDIUM' }, 72))
      .filter((e) => e.basis !== 'default')

    expect(learned.length).toBeGreaterThan(0)
    for (const estimate of learned) {
      expect(estimate.support).toBeGreaterThanOrEqual(modelInfo()!.minSupport)
    }
  })
})
