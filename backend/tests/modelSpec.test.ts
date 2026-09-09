/**
 * The seams between Python and TypeScript.
 *
 * Four models are trained in one language and executed in another. The
 * classifier and predictor suites already prove their arithmetic agrees; these
 * cover the two seams nothing else watches, and both are the kind that fail
 * silently rather than loudly.
 *
 * The first is the contract. Every spec declares the algorithm it was written
 * for, and the executing code declares what it can run. Change the tokeniser in
 * Python without bumping both and the spec is refused rather than mis-executed.
 *
 * The second is `ALLOWED_TRANSITIONS`, which exists twice: once in `gcce.ts` as
 * the product's normative process model, and once in `conformal.py` because the
 * calibration needs it and a build-time dependency from the research harness to
 * the API would be heavier than the thing it prevents. Duplication is the right
 * call there and this is the price of it — a test that fails the moment the two
 * disagree, because a gate calibrated against a process model the product no
 * longer follows is worse than an uncalibrated one.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ComplaintStatus } from '@prisma/client'
import { ALLOWED_TRANSITIONS } from '../src/services/gcce.js'
import { loadSpec } from '../src/services/modelSpec.js'

const SPECS = [
  { file: 'classifier-spec.json', contract: 'clf/tfidf-l2/multinomial-nb/1' },
  { file: 'predictor-spec.json', contract: 'pred/counting-backoff/1' },
  { file: 'sla-spec.json', contract: 'sla/empirical-quantiles/1' },
  { file: 'gate-spec.json', contract: 'gate/split-conformal/1' },
]

describe('every shipped spec matches the contract its executor declares', () => {
  for (const { file, contract } of SPECS) {
    const present = existsSync(path.resolve(process.cwd(), 'data', file))
    const run = present ? it : it.skip

    run(`${file} loads under ${contract}`, () => {
      expect(loadSpec(file, contract), `${file} was refused`).not.toBeNull()
    })
  }

  it('refuses a spec written for a different algorithm', () => {
    expect(loadSpec('predictor-spec.json', 'pred/counting-backoff/99')).toBeNull()
  })

  it('returns null rather than throwing for a spec that does not exist', () => {
    expect(loadSpec('no-such-spec.json', 'whatever/1')).toBeNull()
  })
})

describe('the process model the gate was calibrated against', () => {
  const gatePath = path.resolve(process.cwd(), 'data', 'gate-spec.json')
  const present = existsSync(gatePath)
  const run = present ? it : it.skip

  /**
   * `riskOfAction` in the spec is keyed by every activity the calibration knew
   * about. If the product gains a status the calibration never saw, the gate
   * would classify it as HIGH by the fallback and quietly refuse it forever —
   * which is safe, but silently so, and the calibration should be re-run
   * instead.
   */
  run('knows every status the product can transition into', () => {
    const spec = JSON.parse(readFileSync(gatePath, 'utf8')) as {
      riskOfAction: Record<string, string>
    }

    const reachable = new Set<string>()
    for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
      for (const target of targets) reachable.add(target)
    }

    const unknown = [...reachable].filter((s) => !(s in spec.riskOfAction))
    expect(
      unknown,
      `the gate has no risk class for ${unknown.join(', ')} — re-run the calibration`,
    ).toEqual([])
  })

  run('classifies nothing the product cannot actually reach', () => {
    const spec = JSON.parse(readFileSync(gatePath, 'utf8')) as {
      riskOfAction: Record<string, string>
    }

    const reachable = new Set<string>(['<END>'])
    for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
      for (const target of targets) reachable.add(target)
    }

    const stale = Object.keys(spec.riskOfAction).filter((a) => !reachable.has(a))
    expect(stale, `the gate still classifies ${stale.join(', ')}, which nothing reaches`).toEqual(
      [],
    )
  })

  /**
   * Terminal statuses are where the two copies most easily drift: adding a way
   * out of CLOSED in the product would silently invalidate a calibration that
   * assumed there was none.
   */
  run('agrees with the product about which statuses are terminal', () => {
    for (const status of [
      ComplaintStatus.CLOSED,
      ComplaintStatus.REJECTED,
      ComplaintStatus.DUPLICATE,
    ]) {
      expect(ALLOWED_TRANSITIONS[status], `${status} is no longer terminal`).toEqual([])
    }
  })
})
