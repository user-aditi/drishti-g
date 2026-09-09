/**
 * The autonomy gate: may this action execute without a human?
 *
 * Three inputs, one verdict. How confident is the predictor, which actions does
 * policy permit in this state, and how costly is a mistake on the action it
 * chose. Confidence is renormalised **over the permitted actions only** — the
 * separation between *predictive* confidence and *automation* confidence is the
 * idea the whole component is built on, and both are returned so the difference
 * is visible rather than asserted.
 *
 * What the calibration found, and why it shapes this file
 * -------------------------------------------------------
 * `research/drishti_research/conformal.py` picks each threshold so the observed
 * error among admitted decisions stays within a stated tolerance. Run against
 * 2,309 cases it returned:
 *
 *     LOW      tolerance 10%   threshold 0.55   error 4.7%   coverage 88.8%
 *     MEDIUM   tolerance  5%   no threshold works
 *     HIGH     tolerance  1%   no threshold works
 *
 * For MEDIUM and HIGH there is no confidence level, down to a coin flip, at
 * which the error rate is acceptable. Worse, MEDIUM is **anti-calibrated**:
 * error *rises* from 18.8% to 27.2% as confidence goes from 0.80 to 0.90, so a
 * stricter bar admits worse decisions. Raising the threshold there does not make
 * the gate safer, it makes it wrong more confidently.
 *
 * So this gate automates low-risk actions and nothing else, and it does so
 * because the data said to — not because a release-1 policy said to be careful.
 * If a later dataset supports more, `gate-spec.json` will say so and this file
 * needs no change.
 *
 * A note for anyone reading the aggregate calibration
 * ---------------------------------------------------
 * The predictor's headline table (0.976 / 0.924 / 0.664 / 0.515 down the
 * confidence bands) looks like a well-behaved model, and it is — in aggregate.
 * That aggregate is dominated by `<END>` and `AWAITING_VERIFICATION`, which are
 * structurally predictable. Split by risk class, the actions anyone would
 * actually want to automate carry almost no usable signal. **The aggregate
 * table is not evidence that a gate can automate meaningful work**, and reading
 * it that way is the mistake this comment exists to prevent.
 *
 * Pure by construction
 * --------------------
 * `evaluate` takes everything it needs as arguments and touches no database, so
 * the rule can be tested without fixtures and read without tracing queries.
 * `evaluateComplaint` is the thin wrapper that fetches.
 */
import type { ComplaintStatus, Prisma, PrismaClient, RiskBand } from '@prisma/client'
import { loadSpec, type SpecEnvelope } from './modelSpec.js'
import { DecisionKind, DecisionOutcome } from '@prisma/client'
import * as decisions from './decisions.js'
import { permittedActions, type Actor, type FeasibilityTarget } from './feasibility.js'
import { OPEN_STATUSES } from './gcce.js'
import { endToken, predictNext, type Prediction } from './predictor.js'


type Db = PrismaClient | Prisma.TransactionClient

export type RiskClass = 'LOW' | 'MEDIUM' | 'HIGH'
export type Verdict = 'AUTO' | 'REVIEW'

interface ThresholdSpec {
  threshold: number
  alpha: number
  observedError: number
  coverage: number
  calibratedOn: number
  automatable: boolean
  why: string
}

interface GateSpec extends SpecEnvelope {
  floor: number
  thresholds: Record<RiskClass, ThresholdSpec>
  riskOfAction: Record<string, RiskClass>
  infeasibleArgmaxRate: number
  note: string
}

export interface GateDecision {
  /** What the model expects to happen next, after policy filtering. */
  action: string | null
  /** Top probability over the whole alphabet, before policy is applied. */
  rawConfidence: number
  /** Top probability after non-permitted actions are removed. The gate's input. */
  automationConfidence: number
  permitted: string[]
  riskClass: RiskClass | null
  /** GRIE's band for the unit holding this complaint, where one is known. */
  riskBand: RiskBand | null
  threshold: number
  verdict: Verdict
  /** Plain sentences, in the same voice as GCCE's. */
  reasons: string[]
  /** Renormalised probability per permitted action, for the register. */
  distribution: Record<string, number>
}

const CONTRACT = 'gate/split-conformal/1'

function load(): GateSpec | null {
  return loadSpec<GateSpec>('gate-spec.json', CONTRACT)
}

/**
 * How much a GRIE band raises the bar.
 *
 * A unit GRIE already considers troubled is the last place to hand more
 * decisions to a machine: whatever is going wrong there is not yet understood,
 * and automation would remove the human most likely to notice. SEVERE stops
 * automation entirely rather than merely discouraging it.
 */
const BAND_PENALTY: Record<string, number> = {
  LOW: 0,
  MODERATE: 0,
  HIGH: 0.1,
}

/**
 * Bands where automation stops outright, rather than merely becoming harder.
 *
 * Expressed as its own rule because the first version encoded it as a penalty
 * of 1.0, reasoning that no confidence could exceed a threshold of 1.0. A
 * confidence of exactly 1.0 does, and a test caught it — the gate happily
 * automated inside a SEVERE unit. "Never" should not be arithmetic that happens
 * to be unreachable; when the arithmetic shifts, the guarantee goes with it.
 */
const NEVER_AUTOMATE_BANDS = new Set(['SEVERE'])

/**
 * Decide, from values already gathered.
 *
 * `prediction` may be null when the model has never seen anything like this
 * case, and that is not a failure — an unrecognised situation is exactly one a
 * human should look at, and the gate says so.
 */
export function evaluate(input: {
  prediction: Prediction | null
  permitted: string[]
  riskBand?: RiskBand | null
}): GateDecision {
  const model = load()
  const reasons: string[] = []
  const riskBand = input.riskBand ?? null

  const base: GateDecision = {
    action: null,
    rawConfidence: 0,
    automationConfidence: 0,
    permitted: input.permitted,
    riskClass: null,
    riskBand,
    threshold: 1,
    verdict: 'REVIEW',
    reasons,
    distribution: {},
  }

  if (!model) {
    reasons.push('No calibrated thresholds are available, so nothing runs unattended.')
    return base
  }

  if (!input.prediction) {
    reasons.push('Nothing comparable has happened before, so this needs a person.')
    return base
  }

  base.rawConfidence = input.prediction.probability

  if (input.permitted.length === 0) {
    reasons.push('Policy permits no action from this state, so there is nothing to automate.')
    return base
  }

  // Renormalise over the permitted set. This is the whole idea: a model may be
  // confident about something an officer of this rank is not allowed to do, and
  // that confidence must not count towards automating it.
  const allowed = input.prediction.distribution.filter((d) => input.permitted.includes(d.action))
  const mass = allowed.reduce((sum, d) => sum + d.probability, 0)

  if (allowed.length === 0 || mass === 0) {
    reasons.push(
      `The model expects ${input.prediction.action}, which policy does not permit here. Nothing can be automated.`,
    )
    return base
  }

  const best = allowed.reduce((a, b) => (b.probability > a.probability ? b : a))
  base.action = best.action
  base.automationConfidence = best.probability / mass
  base.distribution = Object.fromEntries(allowed.map((d) => [d.action, d.probability / mass]))

  if (best.action !== input.prediction.action) {
    /*
     * Two different things look alike here, and conflating them inflated the
     * headline number forty-fold on the first live sweep.
     *
     * The model predicting `<END>` for an open complaint means it expects the
     * case to be over — a claim about the case, and often a right one. Policy
     * did not forbid that; it simply is not an action, so the wrapper removed
     * it before the gate saw the list. Reporting it as "policy rules out your
     * top pick" reads as a constraint violation, which is the one metric this
     * component exists to count.
     *
     * A real forbidden pick is a *transition* the model wants and policy
     * refuses. Those are the 1.9% the calibration measured, and they are what
     * the gate is for.
     */
    reasons.push(
      input.prediction.action === endToken()
        ? `The model expects this case to be finished, so the most likely remaining action is ${best.action}.`
        : `The model's first choice was ${input.prediction.action}, which policy rules out; ${best.action} is the most likely permitted action.`,
    )
  }

  const riskClass = model.riskOfAction[best.action] ?? 'HIGH'
  base.riskClass = riskClass
  const rule = model.thresholds[riskClass]

  // Checked before the risk class, because it applies whatever the action is
  // and it is the more useful thing to tell an officer when both hold: the
  // unit is in trouble, and that is a fact about the place rather than about
  // this one decision.
  if (riskBand && NEVER_AUTOMATE_BANDS.has(riskBand)) {
    base.threshold = 1
    reasons.push(
      `GRIE rates this unit ${riskBand}, so nothing here runs unattended whatever the confidence. Whatever is going wrong is not yet understood, and automating would remove the person most likely to notice.`,
    )
    return base
  }

  if (!rule?.automatable) {
    base.threshold = 1
    reasons.push(
      `${best.action} is a ${riskClass.toLowerCase()}-risk action. ${rule?.why ?? 'It has no calibrated threshold.'}`,
    )
    return base
  }

  const penalty = riskBand ? (BAND_PENALTY[riskBand] ?? 0) : 0
  const threshold = Math.min(1, rule.threshold + penalty)
  base.threshold = threshold

  if (penalty > 0) {
    reasons.push(
      `GRIE rates this unit ${riskBand}, so the bar rises from ${rule.threshold.toFixed(2)} to ${threshold.toFixed(2)}.`,
    )
  }

  const clears = base.automationConfidence >= threshold
  base.verdict = clears ? 'AUTO' : 'REVIEW'

  reasons.push(
    `Only ${input.permitted.join(', ')} ${input.permitted.length === 1 ? 'is' : 'are'} permitted here, so confidence is measured over ${input.permitted.length === 1 ? 'that one option' : 'those options'}.`,
  )
  reasons.push(
    clears
      ? `Confidence ${base.automationConfidence.toFixed(2)} clears the ${threshold.toFixed(2)} bar for a ${riskClass.toLowerCase()}-risk action, which was set to keep errors under ${(rule.alpha * 100).toFixed(0)}%.`
      : `Confidence ${base.automationConfidence.toFixed(2)} is short of the ${threshold.toFixed(2)} bar, so an officer decides.`,
  )

  return base
}

/** The database-backed wrapper: gather, then apply the rule above. */
export async function evaluateComplaint(
  db: Db,
  complaint: FeasibilityTarget & { status: ComplaintStatus },
  actor?: Actor,
  riskBand?: RiskBand | null,
): Promise<GateDecision> {
  const [prediction, permitted] = await Promise.all([
    predictNext(db, complaint.id),
    permittedActions(db, complaint, actor),
  ])

  // The end token is a prediction, never an action. "This case is finished" is
  // a useful thing for the model to say and not a thing to execute.
  const actionable = permitted.map(String).filter((a) => a !== endToken())

  return evaluate({ prediction, permitted: actionable, riskBand })
}

/** What the calibration run measured, for the console to display. */
export function gateInfo(): GateSpec | null {
  return load()
}


// ---------------------------------------------------------------------------
// Recording what the gate would have done
// ---------------------------------------------------------------------------
//
// The gate executes nothing. Every status transition in this system is a claim
// somebody should stand behind, and the calibration found no confidence level
// at which any of them may be made unattended — so there is no execution path
// to write, and inventing one would be building machinery for a decision the
// evidence says not to take.
//
// What it does instead is worth having on its own terms. It says, for each open
// complaint, what it expects next, how sure it is *given what policy permits*,
// and why it is not willing to act. That produces two useful things: a review
// queue ordered by how uncertain the system is rather than by age, and a record
// against which a future calibration can be argued. If a later dataset shows a
// class can be safely automated, the argument for turning it on will be made
// from these rows.

export interface Assessment {
  complaintId: number
  decision: GateDecision
  recorded: boolean
}

/**
 * Evaluate one complaint and record the verdict as a Decision.
 *
 * Recorded as `NEXT_ACTION` with `source: 'autonomy'`, which keeps it
 * distinguishable from GCCE's routing decisions in the same table — they are
 * different kinds of judgement and mixing them would make the agreement rate
 * meaningless.
 */
export async function assess(
  db: Db,
  complaint: FeasibilityTarget & { status: ComplaintStatus },
  riskBand?: RiskBand | null,
): Promise<Assessment> {
  const decision = await evaluateComplaint(db, complaint, undefined, riskBand)

  // Nothing to say about a case with no permitted actions and no prediction —
  // recording those would fill the register with rows that carry no judgement.
  if (!decision.action) {
    return { complaintId: complaint.id, decision, recorded: false }
  }

  await decisions.record(db, {
    kind: DecisionKind.NEXT_ACTION,
    complaintId: complaint.id,
    chosen: decision.action,
    // Every permitted action with the probability the gate gave it, so the
    // register shows what was considered rather than only what won.
    alternatives: decision.permitted.map((action) => ({
      value: action,
      label: action.toLowerCase().replaceAll('_', ' '),
      score: decision.distribution[action] ?? 0,
    })),
    confidence: decision.automationConfidence,
    feasibleSet: decision.permitted,
    reasons: decision.reasons,
    source: 'autonomy',
    outcome: DecisionOutcome.PENDING,
  })

  return { complaintId: complaint.id, decision, recorded: true }
}

export interface AutonomySweepResult {
  considered: number
  assessed: number
  wouldAutomate: number
  needsReview: number
  noPrediction: number
  /** The model wanted a transition policy refuses — what the gate is for. */
  forbiddenTopPick: number
  /** The model expects the case is over. Not a violation; a different claim. */
  predictedFinished: number
}

/**
 * Assess every open complaint that has not been assessed since its last change.
 *
 * Runs on the scheduler rather than inside each transition. The gate is
 * advisory, so its answer does not need to be synchronous with the action —
 * and keeping it out of the filing transaction means a slow or broken model can
 * never stop a citizen filing a complaint.
 */
export async function sweepAutonomy(db: Db): Promise<AutonomySweepResult> {
  const open = await db.complaint.findMany({
    where: { status: { in: OPEN_STATUSES } },
    select: {
      id: true,
      status: true,
      departmentId: true,
      sectorId: true,
      orgUnitId: true,
      assignedOfficerId: true,
      updatedAt: true,
      decisions: {
        where: { kind: DecisionKind.NEXT_ACTION, source: 'autonomy' },
        orderBy: { id: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  })

  const result: AutonomySweepResult = {
    considered: open.length,
    assessed: 0,
    wouldAutomate: 0,
    needsReview: 0,
    noPrediction: 0,
    forbiddenTopPick: 0,
    predictedFinished: 0,
  }

  // Band lookups are per unit, not per complaint — a sector's risk does not
  // change between two complaints in the same sweep.
  const bands = new Map<number, RiskBand | null>()

  for (const complaint of open) {
    // Skip anything already assessed since it last changed. Without this the
    // sweep rewrites the same verdict every hour and the register becomes
    // unreadable.
    const last = complaint.decisions[0]
    if (last && last.createdAt >= complaint.updatedAt) continue

    let band: RiskBand | null = null
    if (complaint.orgUnitId != null) {
      if (!bands.has(complaint.orgUnitId)) {
        const score = await db.riskScore.findFirst({
          where: { entityType: 'ORG_UNIT', entityId: complaint.orgUnitId },
          orderBy: { id: 'desc' },
          select: { band: true },
        })
        bands.set(complaint.orgUnitId, score?.band ?? null)
      }
      band = bands.get(complaint.orgUnitId) ?? null
    }

    const { decision, recorded } = await assess(db, complaint, band)
    if (!recorded) {
      result.noPrediction++
      continue
    }

    result.assessed++
    if (decision.verdict === 'AUTO') result.wouldAutomate++
    else result.needsReview++
    if (decision.reasons.some((r) => r.includes('policy rules out'))) result.forbiddenTopPick++
    if (decision.reasons.some((r) => r.includes('expects this case to be finished'))) {
      result.predictedFinished++
    }
  }

  return result
}
