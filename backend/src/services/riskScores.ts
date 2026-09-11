/**
 * Scoring every unit-month, and keeping what the model said. Layer 3.
 *
 * A recompute replaces the current model's rows wholesale rather than updating
 * them in place. It is a re-derivation from the requests, not an edit: a unit
 * whose history changed should have the score its history now implies, and a
 * row left over from a previous pass would be a score no current input produces.
 * Rows from other model versions are kept, so a new model can be compared
 * against the one it replaced on the same months.
 *
 * Each stored row carries the outcome once it is on record — whether the next
 * month's missed-deadline rate landed in the worst fifth — so the register can
 * show beside every prediction what then happened.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import * as audit from './audit.js'
import { grieSpec, scoreUnit, SIGNAL_KEYS, type GrieSpec, type Signals } from './grie.js'
import { unitMonths, type UnitMonth } from './riskSignals.js'

export class NoModelError extends Error {}

export function requireSpec(): GrieSpec {
  const spec = grieSpec()
  if (!spec) {
    throw new NoModelError(
      'No GRIE model is loaded. Export one with: cd research && python -m drishti_research.nyc_grie',
    )
  }
  return spec
}

export const signalsOf = (m: UnitMonth): Signals =>
  Object.fromEntries(SIGNAL_KEYS.map((key) => [key, m[key]])) as Signals

export async function recompute(actor: { id: number | null; label: string }) {
  const spec = requireSpec()
  const started = Date.now()
  const months = await unitMonths(spec.markers, spec.minRequests)

  const data: Prisma.RiskScoreCreateManyInput[] = months.map((m) => {
    const signals = signalsOf(m)
    const result = scoreUnit(spec, signals, m.agencyCode)
    return {
      agencyId: m.agencyId,
      orgUnitId: m.orgUnitId,
      month: m.month,
      requests: m.requests,
      signals: signals as unknown as Prisma.InputJsonValue,
      factors: result.factors as unknown as Prisma.InputJsonValue,
      score: result.score,
      probability: result.probability,
      needsReview: result.needsReview,
      nextBreachRate: m.nextBreachRate,
      outcome: m.nextBreachRate === null ? null : m.nextBreachRate >= spec.label.cutoff,
      modelVersion: spec.modelVersion,
    }
  })

  const flagged = data.filter((d) => d.needsReview).length
  const firstMonth = months[0]?.month.toISOString().slice(0, 7) ?? null
  const lastMonth = months[months.length - 1]?.month.toISOString().slice(0, 7) ?? null

  await prisma.$transaction(
    async (tx) => {
      await tx.riskScore.deleteMany({ where: { modelVersion: spec.modelVersion } })
      for (let i = 0; i < data.length; i += 1000) {
        await tx.riskScore.createMany({ data: data.slice(i, i + 1000) })
      }
      await audit.record(tx, {
        action: 'risk.recomputed',
        entityType: 'risk_model',
        entityId: spec.modelVersion,
        payload: { modelVersion: spec.modelVersion, unitMonths: data.length, flagged, firstMonth, lastMonth },
        actorId: actor.id,
        actorLabel: actor.label,
        source: actor.id === null ? 'system' : 'api',
      })
    },
    { timeout: 120_000 },
  )

  return {
    modelVersion: spec.modelVersion,
    unitMonths: data.length,
    flagged,
    firstMonth,
    lastMonth,
    tookMs: Date.now() - started,
  }
}
