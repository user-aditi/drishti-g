import { Router } from 'express'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { grieSpec, type GrieSpec } from '../services/grie.js'
import { NoModelError, recompute } from '../services/riskScores.js'
import { asyncHandler, badRequest, notFound } from '../utils/http.js'

/**
 * The risk register. Layer 3 — NYC 311 scores nothing.
 *
 * Administrator only. A board's risk score is a statement about the people who
 * work there, made by a model; who sees it is a decision, and the plan gives it
 * to the administrator's console rather than to the agencies being scored.
 */
export const riskRouter: Router = Router()
riskRouter.use(authenticate, requireRole(Role.ADMIN))

const monthStart = (month: string) => new Date(`${month}-01T00:00:00.000Z`)
const monthKey = (date: Date) => date.toISOString().slice(0, 7)

function loaded(): GrieSpec {
  const spec = grieSpec()
  if (!spec) throw notFound('No GRIE model is loaded. Export one with python -m drishti_research.nyc_grie')
  return spec
}

/**
 * The model, as a reader needs it: what it predicts, what it weighs, and how it
 * did against the alternatives — including the one-factor rule that beat it.
 */
riskRouter.get(
  '/model',
  asyncHandler(async (_req, res) => {
    const spec = loaded()
    res.json({
      modelVersion: spec.modelVersion,
      chosen: spec.chosen,
      unit: spec.unit,
      label: spec.label,
      trainedOn: spec.trainedOn,
      minRequests: spec.minRequests,
      reviewProbability: spec.reviewProbability,
      factors: spec.factors,
      handSpecified: spec.handSpecified,
      evaluation: spec.evaluation,
    })
  }),
)

const unitsSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month as YYYY-MM')
    .optional(),
  agency: z.string().trim().toUpperCase().max(8).optional(),
})

/**
 * One month's units, ranked within each agency by score.
 *
 * Ranked by score and shown with probability. The calibration map is a step
 * function, so many units share a probability; the score underneath it still
 * orders them, and ordering is what the score is for.
 */
riskRouter.get(
  '/units',
  asyncHandler(async (req, res) => {
    const spec = loaded()
    const parsed = unitsSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data

    const months = await prisma.$queryRaw<{ month: Date; units: number; flagged: number }[]>`
      SELECT month, count(*)::int AS units, count(*) FILTER (WHERE "needsReview")::int AS flagged
      FROM risk_scores WHERE "modelVersion" = ${spec.modelVersion}
      GROUP BY month ORDER BY month DESC
    `
    const base = {
      modelVersion: spec.modelVersion,
      reviewProbability: spec.reviewProbability,
      label: spec.label,
      months: months.map((m) => ({ month: monthKey(m.month), units: m.units, flagged: m.flagged })),
      agency: q.agency ?? null,
    }
    if (months.length === 0) {
      res.json({ ...base, month: null, rows: [], summary: null })
      return
    }

    const month = q.month ?? monthKey(months[0]!.month)
    const rows = await prisma.riskScore.findMany({
      where: {
        modelVersion: spec.modelVersion,
        month: monthStart(month),
        ...(q.agency ? { agency: { code: q.agency } } : {}),
      },
      include: {
        agency: { select: { code: true, name: true } },
        orgUnit: { select: { code: true, name: true } },
      },
      orderBy: [{ agency: { code: 'asc' } }, { score: 'desc' }],
    })

    const sizes = new Map<string, number>()
    for (const r of rows) sizes.set(r.agency.code, (sizes.get(r.agency.code) ?? 0) + 1)
    const seen = new Map<string, number>()
    const out = rows.map((r) => {
      const rank = (seen.get(r.agency.code) ?? 0) + 1
      seen.set(r.agency.code, rank)
      return {
        id: r.id,
        agency: r.agency,
        board: r.orgUnit,
        month,
        requests: r.requests,
        score: r.score,
        probability: r.probability,
        needsReview: r.needsReview,
        rank,
        of: sizes.get(r.agency.code) ?? 0,
        factors: r.factors,
        signals: r.signals,
        nextBreachRate: r.nextBreachRate,
        outcome: r.outcome,
      }
    })

    const known = out.filter((r) => r.outcome !== null)
    const flaggedKnown = known.filter((r) => r.needsReview)
    res.json({
      ...base,
      month,
      rows: out,
      summary: {
        units: out.length,
        flagged: out.filter((r) => r.needsReview).length,
        withOutcome: known.length,
        failed: known.filter((r) => r.outcome).length,
        flaggedWithOutcome: flaggedKnown.length,
        flaggedThatFailed: flaggedKnown.filter((r) => r.outcome).length,
      },
    })
  }),
)

/** Rescore every unit-month from the requests as they now stand. */
riskRouter.post(
  '/recompute',
  asyncHandler(async (req, res) => {
    try {
      res.json(await recompute({ id: req.user!.id, label: req.user!.name }))
    } catch (err) {
      if (err instanceof NoModelError) throw notFound(err.message)
      throw err
    }
  }),
)
