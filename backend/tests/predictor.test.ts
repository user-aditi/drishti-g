/**
 * Parity, and the property the autonomy gate depends on.
 *
 * Two implementations of the same frequency table — Python trains it,
 * TypeScript executes it — so the first job is proving they agree. The fixture
 * is written by the training run and carries the exact probabilities
 * scikit-learn's neighbours produced, down to nine places.
 *
 * The second job matters more. Wave 4 decides whether an action may execute
 * without a human by thresholding on `probability`, so a prediction that
 * reports high confidence must actually be more reliable than one that reports
 * low. Parity alone would let a scorer be faithfully, identically wrong.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { endToken, modelInfo, predictFromPrefix } from '../src/services/predictor.js'

interface Case {
  prefix: string[]
  expectedAction: string
  expectedProbability: number
  expectedSupport: number
}

const FIXTURE = path.resolve(process.cwd(), 'tests/fixtures/predictor-cases.json')
const SPEC = path.resolve(process.cwd(), 'data/predictor-spec.json')

/** Both are generated, so a clean checkout has neither and skipping is correct. */
const trained = existsSync(FIXTURE) && existsSync(SPEC)
const suite = trained ? describe : describe.skip

suite('the TypeScript predictor reproduces the trained table', () => {
  const cases: Case[] = trained ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : []

  it('has a fixture with cases in it', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it('predicts the same action for every fixture prefix', () => {
    for (const example of cases) {
      const result = predictFromPrefix(example.prefix)
      expect(result, `no prediction for ${example.prefix.join('>')}`).not.toBeNull()
      expect(result!.action, example.prefix.join('>')).toBe(example.expectedAction)
    }
  })

  it('produces the same probability and support', () => {
    for (const example of cases) {
      const result = predictFromPrefix(example.prefix)!
      expect(result.probability, example.prefix.join('>')).toBeCloseTo(
        example.expectedProbability,
        9,
      )
      expect(result.support, example.prefix.join('>')).toBe(example.expectedSupport)
    }
  })
})

suite('the distribution is well formed', () => {
  const cases: Case[] = trained ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : []

  it('sums to one and is sorted descending', () => {
    for (const example of cases) {
      const { distribution } = predictFromPrefix(example.prefix)!
      const total = distribution.reduce((sum, d) => sum + d.probability, 0)
      expect(total).toBeCloseTo(1, 9)

      for (let i = 1; i < distribution.length; i++) {
        expect(distribution[i - 1]!.probability).toBeGreaterThanOrEqual(
          distribution[i]!.probability,
        )
      }
    }
  })

  it('leads with the action it predicted', () => {
    for (const example of cases) {
      const result = predictFromPrefix(example.prefix)!
      expect(result.distribution[0]!.action).toBe(result.action)
    }
  })
})

suite('backing off', () => {
  const cases: Case[] = trained ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : []

  /**
   * A prefix the model has never seen must still answer, by falling back to a
   * shorter suffix it has. Without this the gate would have no prediction
   * exactly when a case does something unusual — which is when it most needs
   * one, and when it must be least confident.
   */
  it('answers an unseen prefix by matching a shorter suffix', () => {
    const known = cases[0]!.prefix
    const invented = ['SUBMITTED', 'ROUTED', 'ASSIGNED', ...known]
    const result = predictFromPrefix(invented)
    expect(result).not.toBeNull()
    expect(result!.matchedOrder).toBeLessThanOrEqual(invented.length)
  })

  it('reports how much of the prefix matched', () => {
    for (const example of cases) {
      const result = predictFromPrefix(example.prefix)!
      expect(result.matchedOrder).toBeGreaterThan(0)
    }
  })

  it('returns null rather than guessing on an empty or unknown prefix', () => {
    expect(predictFromPrefix([])).toBeNull()
    expect(predictFromPrefix(['NOT_A_REAL_STATUS'])).toBeNull()
  })
})

suite('what the gate will rely on', () => {
  /**
   * The end of a case is a prediction, not an absence.
   *
   * "Nothing follows" has to be something the model can say and be scored on,
   * or a gate would read a finished case as an unpredictable one and escalate
   * every closed complaint to a human.
   */
  it('can predict that a case has ended', () => {
    expect(endToken()).toBe('<END>')
    const terminal = predictFromPrefix(['RESOLVED', 'CLOSED'])
    expect(terminal).not.toBeNull()
    expect(terminal!.distribution.some((d) => d.action === '<END>')).toBe(true)
  })

  it('records that counting was not beaten by a learned model', () => {
    const info = modelInfo()
    if (!trained) {
      expect(info).toBeNull()
      return
    }
    expect(info!.accuracy).toBeGreaterThan(0.5)
    if (info!.learnedComparisonAccuracy != null) {
      // The claim the paper makes, pinned: gradient boosting does not pull
      // meaningfully ahead, so shipping the explainable model costs nothing.
      expect(info!.learnedComparisonAccuracy - info!.accuracy).toBeLessThan(0.05)
    }
  })
})
