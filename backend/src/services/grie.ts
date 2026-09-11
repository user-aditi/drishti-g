/**
 * GRIE — the risk radar. Layer 3, and nothing NYC 311 has.
 *
 * This file executes a model; it does not define one. The weights, the curves'
 * caps, the calibration map and the phrases the signals are read from are all
 * in `data/grie-spec.json`, written by `research/drishti_research/nyc_grie.py`
 * after it chose between candidates under grouped cross-validation. Keeping the
 * model as data is what lets the paper say the model it evaluated is the model
 * that runs: there is no second copy of a weight here to drift from the first.
 *
 * What the numbers mean, because the old version got this wrong
 * ----------------------------------------------------------------
 * `score` is a weighted sum on 0-100. It ranks units and is not a probability,
 * though it looks like one: raw, its mean was 0.26 against an observed rate of
 * 0.20. `probability` is the score passed through the isotonic map fitted on
 * out-of-fold scores (N7), and is what the product shows: the chance this unit's
 * missed-deadline rate lands in the worst fifth of the panel next month.
 *
 * What the model is, stated plainly (F-38)
 * ----------------------------------------
 * Tuned on NYC, 80% of the weight sits on this month's missed deadlines and each
 * of the other four factors is held at the tuning floor of 5%. The same factor
 * alone ranks slightly better than the five together. The four stay because the
 * floor exists to keep every factor visible in an explanation; that visibility
 * costs 0.010 AUC here, and the spec records the figure.
 */
import { loadSpec, type SpecEnvelope } from './modelSpec.js'

/** Bump with CONTRACT in nyc_grie.py when the maths below changes. */
export const GRIE_CONTRACT = 'grie-nyc/1'
export const GRIE_SPEC_FILE = 'grie-spec.json'

export const SIGNAL_KEYS = [
  'slaBreachRate',
  'repeatComplaintRate',
  'escalationRate',
  'openComplaintLoad',
  'avgResolutionDays',
] as const
export type SignalKey = (typeof SIGNAL_KEYS)[number]
export type Signals = Record<SignalKey, number>

export type Curve =
  | { kind: 'proportion' }
  | { kind: 'linear'; cap: number; capByAgency?: Record<string, number> }

export interface GrieSpec extends SpecEnvelope {
  chosen: string
  unit: string
  minRequests: number
  label: { description: string; quantile: number; cutoff: number; baseRate: number }
  trainedOn: { rows: number; units: number; firstMonth: string; lastMonth: string }
  markers: { referral: string[]; enforcement: string[]; duplicate: string[] }
  factors: { key: SignalKey; label: string; weight: number; curve: Curve }[]
  handSpecified: { weights: Record<SignalKey, number>; caps: Record<string, number> }
  calibration: { kind: 'isotonic'; x: number[]; y: number[] }
  reviewProbability: number
  evaluation: {
    candidates: Record<
      string,
      { cvAuc: number; cvAucSd: number; withinAgencyAuc: number; maxSaturation: number; saturatedFactor: string }
    >
    shippedVsHand: { aucGap: number; ciLow: number; ciHigh: number }
    shippedVsPersistence: { aucGap: number; ciLow: number; ciHigh: number }
    calibration: Record<string, number>
  }
}

export const grieSpec = (): GrieSpec | null => loadSpec<GrieSpec>(GRIE_SPEC_FILE, GRIE_CONTRACT)

/** One signal on 0-100, exactly as nyc_grie._normalise does it. */
export function normalise(curve: Curve, raw: number, agencyCode: string): number {
  if (curve.kind === 'proportion') return Math.min(100, Math.max(0, raw * 100))
  const cap = curve.capByAgency?.[agencyCode] ?? curve.cap
  return raw <= 0 ? 0 : Math.min(100, Math.max(0, (raw / cap) * 100))
}

/**
 * The isotonic map, as scikit-learn applies it: linear between thresholds,
 * clipped to the end values outside them.
 */
export function calibrate(map: GrieSpec['calibration'], score: number): number {
  const { x, y } = map
  if (x.length === 0) return Number.NaN
  if (score <= x[0]!) return y[0]!
  if (score >= x[x.length - 1]!) return y[y.length - 1]!
  let lo = 0
  let hi = x.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (x[mid]! <= score) lo = mid
    else hi = mid
  }
  const span = x[hi]! - x[lo]!
  return span === 0 ? y[hi]! : y[lo]! + ((score - x[lo]!) / span) * (y[hi]! - y[lo]!)
}

const pct = (raw: number) => `${Math.round(raw * 100)}%`

/** The sentence an officer reads beside each factor. */
function describe(key: SignalKey, raw: number): string {
  switch (key) {
    case 'slaBreachRate':
      return raw > 0
        ? `${pct(raw)} of requests filed this month passed their derived deadline.`
        : 'No request filed this month passed its derived deadline.'
    case 'repeatComplaintRate':
      return raw > 0
        ? `${pct(raw)} came from an address where a request of the same type had already been closed.`
        : 'None came from an address where the same problem had already been closed.'
    case 'escalationRate':
      return raw > 0
        ? `${pct(raw)} were referred to another agency or closed by enforcement rather than a repair.`
        : 'None were referred elsewhere or closed by enforcement.'
    case 'openComplaintLoad':
      return `${Math.round(raw)} requests were still open at the end of the month.`
    case 'avgResolutionDays':
      return raw > 0
        ? `Requests closing this month took ${raw.toFixed(1)} days on average.`
        : 'No request closed this month with a knowable duration.'
  }
}

export interface FactorBreakdown {
  factor: SignalKey
  label: string
  raw: number
  normalised: number
  weight: number
  contribution: number
  explanation: string
}

export interface UnitScore {
  score: number
  probability: number
  needsReview: boolean
  factors: FactorBreakdown[]
  topReason: string
  modelVersion: string
}

/**
 * Score one unit-month. Every score carries its explanation: the raw value of
 * each signal, where the curve put it, the weight, and what that contributed.
 */
export function scoreUnit(spec: GrieSpec, signals: Signals, agencyCode: string): UnitScore {
  let score = 0
  const factors: FactorBreakdown[] = spec.factors.map((factor) => {
    const raw = signals[factor.key]
    const normalised = normalise(factor.curve, raw, agencyCode)
    const contribution = normalised * factor.weight
    score += contribution
    return {
      factor: factor.key,
      label: factor.label,
      raw,
      normalised,
      weight: factor.weight,
      contribution,
      explanation: describe(factor.key, raw),
    }
  })
  const probability = calibrate(spec.calibration, score)
  // What mattered most first. The raw values stay unrounded: rounding belongs
  // to the screen, and the parity check compares these to the study's.
  factors.sort((a, b) => b.contribution - a.contribution)
  return {
    score,
    probability,
    needsReview: probability >= spec.reviewProbability,
    factors,
    topReason: factors[0]?.explanation ?? 'No contributing factors recorded.',
    modelVersion: spec.modelVersion,
  }
}
