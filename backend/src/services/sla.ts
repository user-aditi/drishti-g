/**
 * How long this is likely to take, based on how long it has taken before.
 *
 * Trained by `research/drishti_research/sla.py`, exported as JSON, executed
 * here — the same arrangement as GRIE, the classifier and the predictor.
 *
 * What it replaces, and why that matters to a citizen
 * ---------------------------------------------------
 * Every complaint used to get `category.defaultSlaHours`: one number per
 * category, identical in a sector with four open jobs and one with six hundred.
 * The citizen was then shown a hard deadline derived from it — a promise the
 * system had no evidence it could keep, made in a tone that implied it did.
 *
 * This returns two numbers instead. `p50` is what usually happens, which is the
 * sentence a citizen actually wants. `p90` is the commitment, and GCCE sets the
 * deadline from it, so the deadline is something the unit has historically met
 * nine times in ten rather than a target somebody typed into a seed file.
 *
 * A p90 deadline is *supposed* to breach about a tenth of the time. That is
 * what makes it a promise rather than an aspiration, and it is worth saying out
 * loud before someone reads the breach rate as a regression.
 *
 * Backing off, which is most of the work
 * --------------------------------------
 * Category x unit x priority is a large product and the traffic is not spread
 * evenly across it — a few busy sectors carry most of it and most cells are
 * near-empty. A p90 computed from three cases is noise wearing a number, and
 * shipping it would swing deadlines between neighbouring sectors for no reason
 * anyone could explain to a resident.
 *
 * So each estimate falls back until it finds enough support, and *says which
 * level answered*. That is not diagnostic detail — it decides the wording. The
 * product may only say "usually 2 to 4 days in this sector" where the estimate
 * is genuinely about that sector.
 */
import { loadSpec, type SpecEnvelope } from './modelSpec.js'


/** Which bucket answered — and therefore how specific a claim may be made. */
export type SlaBasis = 'unit+priority' | 'unit' | 'category' | 'default'

interface Bucket {
  p50: number
  p90: number
  n: number
  level: Exclude<SlaBasis, 'default'>
}

interface SlaSpec extends SpecEnvelope {
  trainedOn: number
  minSupport: number
  buckets: Record<string, Bucket>
}

export interface SlaEstimate {
  /** Hours. What usually happens. */
  p50: number
  /** Hours. The commitment GCCE promises. */
  p90: number
  /** Which bucket this came from, and so how specifically it may be worded. */
  basis: SlaBasis
  /** Resolutions behind it. Zero when the seeded default was used. */
  support: number
}

const CONTRACT = 'sla/empirical-quantiles/1'

function load(): SlaSpec | null {
  return loadSpec<SlaSpec>('sla-spec.json', CONTRACT)
}

/**
 * Estimate the resolution time for a complaint about to be routed.
 *
 * `fallbackHours` is the category's seeded `defaultSlaHours`, used when nothing
 * has been learned yet — a young deployment, a new category, or a repo with no
 * trained spec. It is a required argument rather than an optional one because
 * there must always be an answer: GCCE cannot route a complaint without setting
 * a deadline, and a null here would become a complaint with no promise at all.
 */
export function estimateSla(
  params: { categoryId: number; orgUnitId: number | null; priority: string },
  fallbackHours: number,
): SlaEstimate {
  const model = load()
  if (!model) {
    return { p50: fallbackHours, p90: fallbackHours, basis: 'default', support: 0 }
  }

  const { categoryId, orgUnitId, priority } = params

  // Most specific first. Each key is only present in the spec if it cleared
  // MIN_SUPPORT during training, so a hit here is already a trustworthy cell.
  const candidates = [
    orgUnitId != null ? `${categoryId}|${orgUnitId}|${priority}` : null,
    orgUnitId != null ? `${categoryId}|${orgUnitId}|*` : null,
    `${categoryId}|*|*`,
  ].filter((k): k is string => k !== null)

  for (const key of candidates) {
    const bucket = model.buckets[key]
    if (!bucket) continue
    return { p50: bucket.p50, p90: bucket.p90, basis: bucket.level, support: bucket.n }
  }

  return { p50: fallbackHours, p90: fallbackHours, basis: 'default', support: 0 }
}

/**
 * The estimate as a sentence for a citizen.
 *
 * The wording tracks the basis, because the specificity of the claim has to
 * match the specificity of the evidence. Saying "in this sector" about a
 * city-wide average would be a small lie told thousands of times.
 *
 * Rounded to days once past a day, because "usually 51.4 hours" is precision
 * nobody asked for and nobody believes.
 */
export function describeSla(estimate: SlaEstimate): string {
  const low = humanise(estimate.p50)
  const high = humanise(estimate.p90)
  const range = low === high ? low : `${low} to ${high}`

  switch (estimate.basis) {
    case 'unit+priority':
    case 'unit':
      return `Usually ${range} in this area.`
    case 'category':
      return `Usually ${range} for this kind of complaint.`
    case 'default':
      return `We aim to resolve this within ${high}.`
  }
}

function humanise(hours: number): string {
  if (hours < 24) {
    const rounded = Math.max(1, Math.round(hours))
    return `${rounded} hour${rounded === 1 ? '' : 's'}`
  }
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/** What the training run measured, for the console to display. */
export function modelInfo(): Pick<SlaSpec, 'modelVersion' | 'trainedOn' | 'minSupport'> | null {
  const model = load()
  if (!model) return null
  return {
    modelVersion: model.modelVersion,
    trainedOn: model.trainedOn,
    minSupport: model.minSupport,
  }
}
