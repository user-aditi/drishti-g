/**
 * The autonomy gate.
 *
 * The central case, and the reason the component exists: **a model's top
 * prediction being forbidden by policy must never produce AUTO.** The
 * calibration run measured that happening on 1.9% of decisions — 83 out of
 * 4,330 — so this is a live path, not a hypothetical.
 *
 * Everything here runs against injected values rather than a database, because
 * `evaluate` is pure. That is not only convenient: a rule about when a machine
 * may act without a human should be readable in one file, and a test that needs
 * fixtures to express "this must not be automated" has already lost the thread.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate, gateInfo } from '../src/services/autonomy.js'
import type { Prediction } from '../src/services/predictor.js'

const SPEC = path.resolve(process.cwd(), 'data/gate-spec.json')
const calibrated = existsSync(SPEC)
const suite = calibrated ? describe : describe.skip

/** A prediction with a chosen top action and an explicit distribution. */
function prediction(distribution: [string, number][]): Prediction {
  const sorted = [...distribution].sort((a, b) => b[1] - a[1])
  return {
    action: sorted[0]![0],
    probability: sorted[0]![1],
    support: 100,
    distribution: sorted.map(([action, probability]) => ({ action, probability })),
    matchedOrder: 2,
    modelVersion: 'test',
  }
}

suite('a forbidden prediction is never automated', () => {
  /**
   * The whole point, stated as bluntly as it can be: the model is certain about
   * something policy does not allow. Renormalising over the permitted set is
   * what stops that certainty leaking into a verdict.
   */
  it('refuses when the top prediction is not permitted', () => {
    const decision = evaluate({
      prediction: prediction([
        ['CLOSED', 0.99],
        ['AWAITING_VERIFICATION', 0.01],
      ]),
      permitted: ['AWAITING_VERIFICATION'],
    })

    expect(decision.action).toBe('AWAITING_VERIFICATION')
    expect(decision.rawConfidence).toBeCloseTo(0.99)
    // Renormalised over the one permitted option, so it is 1.0 — and the
    // *action* is now the permitted one, which is the safety property.
    expect(decision.automationConfidence).toBeCloseTo(1)
    expect(decision.action).not.toBe('CLOSED')
  })

  it('says plainly that the first choice was ruled out', () => {
    const decision = evaluate({
      prediction: prediction([
        ['CLOSED', 0.9],
        ['AWAITING_VERIFICATION', 0.1],
      ]),
      permitted: ['AWAITING_VERIFICATION'],
    })
    expect(decision.reasons.join(' ')).toContain('policy rules out')
  })

  it('automates nothing when every predicted action is forbidden', () => {
    const decision = evaluate({
      prediction: prediction([
        ['CLOSED', 0.7],
        ['REJECTED', 0.3],
      ]),
      permitted: ['IN_PROGRESS'],
    })
    expect(decision.verdict).toBe('REVIEW')
    expect(decision.action).toBeNull()
    expect(decision.reasons.join(' ')).toContain('does not permit')
  })

  it('automates nothing when policy permits nothing at all', () => {
    const decision = evaluate({
      prediction: prediction([['CLOSED', 1]]),
      permitted: [],
    })
    expect(decision.verdict).toBe('REVIEW')
    expect(decision.reasons.join(' ')).toContain('permits no action')
  })
})

suite('raw and automation confidence are kept apart', () => {
  it('reports both, and they differ when policy bites', () => {
    const decision = evaluate({
      prediction: prediction([
        ['CLOSED', 0.6],
        ['RESOLVED', 0.3],
        ['IN_PROGRESS', 0.1],
      ]),
      permitted: ['RESOLVED', 'IN_PROGRESS'],
    })
    expect(decision.rawConfidence).toBeCloseTo(0.6)
    // 0.3 renormalised over the 0.4 of permitted mass.
    expect(decision.automationConfidence).toBeCloseTo(0.75)
  })

  it('leaves them equal when policy permits the model’s choice', () => {
    const decision = evaluate({
      prediction: prediction([
        ['AWAITING_VERIFICATION', 0.8],
        ['IN_PROGRESS', 0.2],
      ]),
      permitted: ['AWAITING_VERIFICATION', 'IN_PROGRESS'],
    })
    expect(decision.rawConfidence).toBeCloseTo(0.8)
    expect(decision.automationConfidence).toBeCloseTo(0.8)
  })
})

suite('what the calibration decided, enforced', () => {
  /**
   * The finding that shaped the whole component: on this evidence there is no
   * confidence level at which routing or assignment can be automated within a
   * 5% error tolerance, and none at all for closing or rejecting.
   *
   * This is asserted rather than assumed so that a future calibration which
   * *does* open those classes fails here loudly, and someone reads the new
   * numbers before more work runs unattended.
   */
  it('will not automate a medium-risk action however confident the model is', () => {
    const decision = evaluate({
      prediction: prediction([['ASSIGNED', 1]]),
      permitted: ['ASSIGNED'],
    })
    expect(decision.automationConfidence).toBeCloseTo(1)
    expect(decision.riskClass).toBe('MEDIUM')
    expect(decision.verdict).toBe('REVIEW')
    expect(decision.reasons.join(' ')).toContain('No threshold')
  })

  it('will not automate a high-risk action either', () => {
    const decision = evaluate({
      prediction: prediction([['RESOLVED', 1]]),
      permitted: ['RESOLVED'],
    })
    expect(decision.riskClass).toBe('HIGH')
    expect(decision.verdict).toBe('REVIEW')
  })

  /**
   * The conclusion Wave 4 actually reached.
   *
   * `AWAITING_VERIFICATION` was first classified LOW, and automating it would
   * have had the system assert that work happened in the field — no crew, no
   * photograph, no evidence. It is a claim about the physical world. Corrected
   * to HIGH, and with that correction **every status transition in this system
   * is medium or high risk**, because every one of them is a claim somebody
   * should be willing to stand behind.
   *
   * The only LOW member left is `<END>`, which is a prediction that a case is
   * over rather than an action to take. So the gate executes nothing, and this
   * suite pins that rather than leaving it as an emergent accident.
   */
  it('finds no executable action it is willing to automate', () => {
    const executable = [
      'ROUTED',
      'ASSIGNED',
      'IN_PROGRESS',
      'AWAITING_VERIFICATION',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
      'DUPLICATE',
    ]

    for (const action of executable) {
      const decision = evaluate({
        prediction: prediction([[action, 1]]),
        permitted: [action],
      })
      expect(decision.automationConfidence, action).toBeCloseTo(1)
      expect(decision.verdict, `${action} must not be automated`).toBe('REVIEW')
    }
  })

  it('leaves the low-risk path working, for a calibration that later opens one', () => {
    // Exercised through <END>, the only LOW member — not executable in the
    // wrapper, but the arithmetic must stay correct for whenever a future
    // dataset moves a real action into this class.
    const decision = evaluate({
      prediction: prediction([
        ['<END>', 0.95],
        ['IN_PROGRESS', 0.05],
      ]),
      permitted: ['<END>', 'IN_PROGRESS'],
    })
    expect(decision.riskClass).toBe('LOW')
    expect(decision.verdict).toBe('AUTO')
  })

  it('holds back a low-risk action that is not confident enough', () => {
    const decision = evaluate({
      prediction: prediction([
        ['<END>', 0.51],
        ['IN_PROGRESS', 0.49],
      ]),
      permitted: ['<END>', 'IN_PROGRESS'],
    })
    expect(decision.verdict).toBe('REVIEW')
  })
})

suite('GRIE raises the bar where the authority is already struggling', () => {
  it('stops automation entirely in a SEVERE unit', () => {
    const decision = evaluate({
      prediction: prediction([['<END>', 1]]),
      permitted: ['<END>'],
      riskBand: 'SEVERE',
    })
    expect(decision.verdict).toBe('REVIEW')
    expect(decision.reasons.join(' ')).toContain('SEVERE')
  })

  it('raises rather than removes the bar in a HIGH unit', () => {
    const low = evaluate({
      prediction: prediction([['<END>', 1]]),
      permitted: ['<END>'],
      riskBand: 'LOW',
    })
    const high = evaluate({
      prediction: prediction([['<END>', 1]]),
      permitted: ['<END>'],
      riskBand: 'HIGH',
    })
    expect(high.threshold).toBeGreaterThan(low.threshold)
    // Full confidence still clears a raised bar; the penalty discourages, it
    // does not forbid.
    expect(high.verdict).toBe('AUTO')
  })
})

suite('an unfamiliar situation goes to a person', () => {
  it('reviews when the model has no prediction at all', () => {
    const decision = evaluate({ prediction: null, permitted: ['ASSIGNED'] })
    expect(decision.verdict).toBe('REVIEW')
    expect(decision.reasons.join(' ')).toContain('Nothing comparable')
  })
})

suite('every verdict explains itself', () => {
  it('gives a reason an officer could read, in every branch', () => {
    const cases = [
      { prediction: null, permitted: ['ASSIGNED'] },
      { prediction: prediction([['CLOSED', 1]]), permitted: [] },
      { prediction: prediction([['CLOSED', 1]]), permitted: ['IN_PROGRESS'] },
      { prediction: prediction([['ASSIGNED', 1]]), permitted: ['ASSIGNED'] },
      { prediction: prediction([['AWAITING_VERIFICATION', 1]]), permitted: ['AWAITING_VERIFICATION'] },
    ]
    for (const input of cases) {
      const decision = evaluate(input)
      expect(decision.reasons.length).toBeGreaterThan(0)
      for (const reason of decision.reasons) {
        expect(reason.length).toBeGreaterThan(20)
        expect(reason.endsWith('.')).toBe(true)
      }
    }
  })
})

suite('the spec itself', () => {
  it('records that medium-risk actions were anti-calibrated', () => {
    const info = gateInfo()
    expect(info).not.toBeNull()
    expect(info!.thresholds.LOW.automatable).toBe(true)
    expect(info!.thresholds.MEDIUM.automatable).toBe(false)
    expect(info!.thresholds.HIGH.automatable).toBe(false)
  })

  it('kept the measured error inside the tolerance for the class it opened', () => {
    const low = gateInfo()!.thresholds.LOW
    expect(low.observedError).toBeLessThanOrEqual(low.alpha)
    expect(low.coverage).toBeGreaterThan(0)
  })
})
