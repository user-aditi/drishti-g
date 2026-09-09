/**
 * Parity between the model that was measured and the model that would ship.
 *
 * The classifier is trained in Python and executed in TypeScript, which means
 * two implementations of the same arithmetic. They can disagree — a different
 * tokeniser, a missing L2 normalisation, a softmax computed in the wrong space —
 * and nothing would fail. Predictions would simply be a little different from
 * the ones the study measured, for the rest of the project's life.
 *
 * `classifier.py` writes the fixture these run against: a set of texts with the
 * exact category and confidence scikit-learn produced for each. If the two ever
 * drift, this is the only place it shows up.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSIFIER_ENABLED, classify, modelInfo } from '../src/services/classifier.js'

interface Case {
  text: string
  expectedCategory: string
  expectedConfidence: number
}

const FIXTURE = path.resolve(process.cwd(), 'tests/fixtures/classifier-cases.json')
const SPEC = path.resolve(process.cwd(), 'data/classifier-spec.json')

/**
 * Both artefacts are generated, not vendored, so a clean checkout has neither.
 * Skipping is right: this suite proves the two implementations agree, and with
 * nothing to compare there is nothing to prove. It must not fail the build for
 * someone who has not run the training pipeline.
 */
const trained = existsSync(FIXTURE) && existsSync(SPEC)
const suite = trained ? describe : describe.skip

suite('the TypeScript scorer reproduces scikit-learn', () => {
  const cases: Case[] = trained ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : []

  it('has a fixture with cases in it', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it('predicts the same category as Python for every fixture case', () => {
    for (const example of cases) {
      const result = classify(example.text)
      expect(result, `no prediction for: ${example.text.slice(0, 60)}`).not.toBeNull()
      expect(result!.category, `text: ${example.text.slice(0, 60)}`).toBe(example.expectedCategory)
    }
  })

  /**
   * Six decimal places. Tighter than it needs to be on purpose: the failures
   * this catches are structural — a missing normalisation, a softmax over the
   * wrong axis — and those move the number in the third place, not the ninth.
   */
  it('produces the same confidence as Python, to six places', () => {
    for (const example of cases) {
      const result = classify(example.text)!
      expect(result.confidence, `text: ${example.text.slice(0, 60)}`).toBeCloseTo(
        example.expectedConfidence,
        6,
      )
    }
  })

  it('returns a full ranking, not just the winner', () => {
    const result = classify(cases[0]!.text)!
    expect(result.alternatives.length).toBeGreaterThan(1)
    expect(result.alternatives[0]!.category).toBe(result.category)
    // Sorted, descending.
    for (let i = 1; i < result.alternatives.length; i++) {
      expect(result.alternatives[i - 1]!.score).toBeGreaterThanOrEqual(
        result.alternatives[i]!.score,
      )
    }
  })

  it('admits ignorance rather than guessing on text it shares no words with', () => {
    expect(classify('zzzz qqqq xxxx')).toBeNull()
    expect(classify('')).toBeNull()
  })
})

describe('the classifier stays out of the request path', () => {
  /**
   * Measured on held-out phrasings, the trained model scores 10.8% against the
   * keyword matcher's 82.4% on the same rows. Enabling it would replace a
   * working matcher with a worse one. This test is here so that switching it on
   * is a deliberate act with a failing test attached, rather than a flag
   * someone flips without reading why it was off.
   */
  it('is disabled until it stops being worse than the keyword matcher', () => {
    expect(CLASSIFIER_ENABLED).toBe(false)
  })

  it('reports what the training run measured, when a spec exists', () => {
    const info = modelInfo()
    if (!trained) {
      expect(info).toBeNull()
      return
    }
    expect(info).not.toBeNull()
    expect(info!.accuracy).toBeLessThan(info!.keywordBaselineAccuracy)
  })
})
