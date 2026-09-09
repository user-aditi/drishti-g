/**
 * What happens to this complaint next, and how sure we are.
 *
 * Trained by `research/drishti_research/predictor.py`, exported as JSON, and
 * executed here — the same arrangement as GRIE and the classifier, so the model
 * that ships is the model that was measured.
 *
 * The model is a frequency table: for each prefix of activities, the
 * distribution over what followed it, backed off to shorter prefixes when a
 * prefix is unseen. Weytjens and Weber (BPM 2026) found this matches
 * billion-parameter models on next-activity prediction, and the training run
 * checks it here too — gradient boosting on the same split scored 0.815 against
 * counting's 0.815, a difference of exactly zero. So the explainable model is
 * free, which is the whole argument for using it.
 *
 * The confidence matters more than the prediction
 * -----------------------------------------------
 * Wave 4's autonomy gate decides whether an action may execute without a human
 * by thresholding on this number. That only works if the number means
 * something. Measured on held-out cases:
 *
 *     confidence      n     accuracy
 *     0.95-1.00     170     0.976
 *     0.80-0.95     854     0.924
 *     0.60-0.80     605     0.664
 *     0.00-0.60      97     0.515
 *
 * Monotone, and the top band is twice as reliable as the bottom. That spread is
 * what makes a gate possible, and it is why this module ships where the
 * classifier does not.
 *
 * `support` is returned alongside, and callers should use it: a probability of
 * 1.0 computed from two cases and one computed from two hundred are not the
 * same claim, and the gate must not treat them alike.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { loadSpec, type SpecEnvelope } from './modelSpec.js'


type Db = PrismaClient | Prisma.TransactionClient

interface PredictorSpec extends SpecEnvelope {
  trainedOnCases: number
  maxOrder: number
  endToken: string
  accuracy: number
  learnedComparisonAccuracy: number | null
  alphabet: string[]
  /** prefix (activities joined by ">") -> activity -> how many times it followed. */
  distributions: Record<string, Record<string, number>>
}

export interface Prediction {
  /** The most likely next activity, or the end token when the case is done. */
  action: string
  probability: number
  /** How many observed cases that probability was computed from. */
  support: number
  /** The full distribution, descending. The gate renormalises over this. */
  distribution: { action: string; probability: number }[]
  /** How much of the prefix actually matched — 0 means nothing did. */
  matchedOrder: number
  modelVersion: string
}

const CONTRACT = 'pred/counting-backoff/1'

function load(): PredictorSpec | null {
  return loadSpec<PredictorSpec>('predictor-spec.json', CONTRACT)
}

/** The end token, so callers can recognise "nothing follows" without a literal. */
export function endToken(): string {
  return load()?.endToken ?? '<END>'
}

/**
 * Predict from a prefix of activities.
 *
 * Pure, and exported separately from `predictNext` so the gate and its tests can
 * work without a database. Longest matching suffix wins; shorter ones are tried
 * in turn, and null means the model has never seen anything like this.
 */
export function predictFromPrefix(prefix: string[]): Prediction | null {
  const model = load()
  if (!model || prefix.length === 0) return null

  const window = prefix.slice(-model.maxOrder)

  for (let k = 0; k < window.length; k++) {
    const key = window.slice(k).join('>')
    const counts = model.distributions[key]
    if (!counts) continue

    const entries = Object.entries(counts)
    const total = entries.reduce((sum, [, n]) => sum + n, 0)
    if (total === 0) continue

    const distribution = entries
      .map(([action, n]) => ({ action, probability: n / total }))
      .sort((a, b) => b.probability - a.probability)

    return {
      action: distribution[0]!.action,
      probability: distribution[0]!.probability,
      support: total,
      distribution,
      matchedOrder: window.length - k,
      modelVersion: model.modelVersion,
    }
  }

  return null
}

/**
 * Predict for a live complaint, reading its history as the activity prefix.
 *
 * Ordered by `createdAt` then `id`, matching `eventLog.ts` — a burst written
 * inside one transaction shares a timestamp, and a differently-ordered prefix
 * is a different prefix, so the two must agree or the model is asked about
 * something it never saw in training.
 */
export async function predictNext(db: Db, complaintId: number): Promise<Prediction | null> {
  const history = await db.complaintStatusHistory.findMany({
    where: { complaintId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { toStatus: true },
  })

  if (history.length === 0) return null
  return predictFromPrefix(history.map((row) => row.toStatus))
}

/** What the training run measured, for the console and the gate to display. */
export function modelInfo(): Pick<
  PredictorSpec,
  'modelVersion' | 'accuracy' | 'learnedComparisonAccuracy' | 'trainedOnCases'
> | null {
  const model = load()
  if (!model) return null
  return {
    modelVersion: model.modelVersion,
    accuracy: model.accuracy,
    learnedComparisonAccuracy: model.learnedComparisonAccuracy,
    trainedOnCases: model.trainedOnCases,
  }
}
