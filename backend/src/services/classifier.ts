/**
 * The trained complaint classifier, executed in TypeScript.
 *
 * Trained by `research/drishti_research/classifier.py`, exported as JSON, and
 * scored here. Same arrangement GRIE uses in the other direction, and for the
 * same reason: one implementation, so the model that ships is the model that
 * was measured. A Python service in the request path would be a container and a
 * network hop for a hundred lines of arithmetic.
 *
 * IT IS NOT WIRED INTO GCCE, AND SHOULD NOT BE YET
 * ------------------------------------------------
 * The pipeline works. The model does not — not on the data available.
 *
 * Measured on held-out *phrasings* (the split has to group by distinct text,
 * because the simulator draws from about two dozen hand-written templates and a
 * random row split puts verbatim copies of every test example into training,
 * which reports 100% and means nothing):
 *
 *     classifier        10.8%
 *     keyword matcher   82.4%   on the same rows
 *
 * The trained model is seventy points *worse* than the thing it was built to
 * replace. That is not a defect in the model; it is a statement about the
 * corpus. Twenty-three phrasings across ten categories cannot train a text
 * classifier — sixteen in training and seven held out means the model has never
 * seen most of the vocabulary it is tested on, while the keyword matcher's
 * hand-authored terms generalise across phrasings by construction.
 *
 * So `gcce.ts` still calls `matchCategory`, and this module sits ready behind
 * `CLASSIFIER_ENABLED`. Switching it on needs one of:
 *
 *   - a far more varied complaint corpus, real or generated with hundreds of
 *     distinct phrasings rather than tens; or
 *   - enough citizen-confirmed labels to train on genuine supervision, which is
 *     the only source that would exist on a real deployment and currently
 *     numbers in the hundreds.
 *
 * Until then, turning it on would replace a working matcher with a worse one
 * and call it progress. See docs/pending-work.md.
 */
import { loadSpec, type SpecEnvelope } from './modelSpec.js'


/**
 * Off by default, and deliberately not an env flag.
 *
 * A flag invites someone to flip it in an environment without reading why it is
 * off. Turning this on should be a code change that lands with the evidence
 * that the model has stopped being worse than the baseline.
 */
export const CLASSIFIER_ENABLED = false

interface ClassifierSpec extends SpecEnvelope {
  trainedAt: string
  trainedOn: number
  confidenceFloor: number
  labelSource: string
  accuracy: number
  keywordBaselineAccuracy: number
  classes: string[]
  vocabulary: Record<string, number>
  idf: number[]
  classLogPrior: number[]
  featureLogProb: number[][]
}

export interface Classification {
  /** The category *name*, as trained. GCCE resolves it to an id. */
  category: string
  /** Softmax over the joint log-likelihoods, so it is comparable across texts. */
  confidence: number
  alternatives: { category: string; score: number }[]
  modelVersion: string
}

const CONTRACT = 'clf/tfidf-l2/multinomial-nb/1'

function load(): ClassifierSpec | null {
  return loadSpec<ClassifierSpec>('classifier-spec.json', CONTRACT)
}

/**
 * The tokeniser, which must match `classifier.py` exactly.
 *
 * Lowercase, then every run of ASCII letters and digits. Deliberately trivial:
 * every preprocessing step is one more thing two implementations can disagree
 * about, and a disagreement here shifts predictions without failing anywhere.
 * The parity fixture in `tests/classifier.test.ts` is what proves they agree.
 */
function tokenise(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

/**
 * TF-IDF with L2 normalisation, matching scikit-learn's defaults for the
 * settings the training script pins: raw term counts (`sublinear_tf=False`),
 * the smoothed idf already baked into the exported vector, and `norm='l2'`.
 */
function vectorise(text: string, model: ClassifierSpec): Map<number, number> {
  const counts = new Map<number, number>()

  for (const token of tokenise(text)) {
    const index = model.vocabulary[token]
    if (index === undefined) continue
    counts.set(index, (counts.get(index) ?? 0) + 1)
  }

  const weighted = new Map<number, number>()
  let norm = 0
  for (const [index, count] of counts) {
    const value = count * (model.idf[index] ?? 0)
    weighted.set(index, value)
    norm += value * value
  }

  if (norm === 0) return weighted
  norm = Math.sqrt(norm)
  for (const [index, value] of weighted) weighted.set(index, value / norm)
  return weighted
}

/**
 * Score one complaint.
 *
 * Returns null when there is no model, or when the text shares no vocabulary
 * with it at all — an unrecognised text produces a uniform posterior, and
 * reporting the alphabetically-first class with a plausible-looking confidence
 * would be worse than admitting ignorance.
 */
export function classify(text: string): Classification | null {
  const model = load()
  if (!model) return null

  const vector = vectorise(text, model)
  if (vector.size === 0) return null

  // Multinomial Naive Bayes: prior plus the weighted feature log-probabilities.
  const joint = model.classLogPrior.map((prior, classIndex) => {
    let total = prior
    const row = model.featureLogProb[classIndex]!
    for (const [index, value] of vector) total += value * (row[index] ?? 0)
    return total
  })

  // Softmax in log space, shifted by the max so exp() cannot overflow.
  const highest = Math.max(...joint)
  const exponentials = joint.map((v) => Math.exp(v - highest))
  const sum = exponentials.reduce((a, b) => a + b, 0)
  const posterior = exponentials.map((v) => v / sum)

  const ranked = posterior
    .map((score, i) => ({ category: model.classes[i]!, score }))
    .sort((a, b) => b.score - a.score)

  return {
    category: ranked[0]!.category,
    confidence: ranked[0]!.score,
    alternatives: ranked.slice(0, 5),
    modelVersion: model.modelVersion,
  }
}

/** What the training run measured, for the decisions register to display. */
export function modelInfo(): Pick<
  ClassifierSpec,
  'modelVersion' | 'accuracy' | 'keywordBaselineAccuracy' | 'trainedOn' | 'labelSource'
> | null {
  const model = load()
  if (!model) return null
  return {
    modelVersion: model.modelVersion,
    accuracy: model.accuracy,
    keywordBaselineAccuracy: model.keywordBaselineAccuracy,
    trainedOn: model.trainedOn,
    labelSource: model.labelSource,
  }
}
