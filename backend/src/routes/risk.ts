/**
 * GRIE's public surface: the risk queue, per-entity explanations, and review
 * actions.
 *
 * Every response that carries a score also carries its factor breakdown. That
 * is the product claim and the paper's claim, so the API does not offer a way
 * to fetch a bare number.
 */
import { Router } from 'express'
import { ReviewStatus, RiskEntityType, UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { FACTOR_SETS, REVIEW_THRESHOLD, MODEL_VERSION } from '../services/grie.js'
import {
  RISK_BAND_ORDER,
  collectSignals,
  latestScore,
  recomputeAll,
  recomputeEntity,
} from '../services/riskSignals.js'
import { asyncHandler, notFound } from '../utils/http.js'

export const riskRouter: Router = Router()

riskRouter.use(authenticate, requireRole(UserRole.ADMIN))

/** The supervisor review queue: most severe first, then most recent. */
riskRouter.get(
  '/queue',
  validate(
    z.object({
      status: z.nativeEnum(ReviewStatus).default(ReviewStatus.PENDING),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { status } = req.query as unknown as { status: ReviewStatus }

    const flags = await prisma.riskFlag.findMany({
      where: { status },
      include: { riskScore: true, reviewedBy: { select: { id: true, fullName: true } } },
      orderBy: { updatedAt: 'desc' },
    })

    const items = flags
      .map((f) => ({
        id: f.id,
        entityType: f.entityType,
        entityId: f.entityId,
        entityLabel: f.entityLabel,
        score: f.score,
        band: f.band,
        reason: f.reason,
        status: f.status,
        reviewNote: f.reviewNote,
        reviewedAt: f.reviewedAt,
        reviewedBy: f.reviewedBy,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        factors: f.riskScore.factors,
      }))
      .sort((a, b) => RISK_BAND_ORDER[a.band] - RISK_BAND_ORDER[b.band] || b.score - a.score)

    res.json({ items, total: items.length, threshold: REVIEW_THRESHOLD })
  }),
)

/** Current score for every ward — powers the admin overview. */
riskRouter.get(
  '/wards',
  asyncHandler(async (_req, res) => {
    const wards = await prisma.ward.findMany({ orderBy: { wardNumber: 'asc' } })

    const items = await Promise.all(
      wards.map(async (ward) => {
        const score = await latestScore(RiskEntityType.WARD, ward.id)
        return {
          wardId: ward.id,
          wardNumber: ward.wardNumber,
          name: ward.name,
          zone: ward.zone,
          score: score?.score ?? null,
          band: score?.band ?? null,
          factors: score?.factors ?? [],
          computedAt: score?.computedAt ?? null,
        }
      }),
    )

    res.json({ items, threshold: REVIEW_THRESHOLD })
  }),
)

/**
 * Full explanation for one entity: the stored score, the raw signals it was
 * computed from, and the weights in force. Everything needed to reproduce the
 * number by hand.
 */
riskRouter.get(
  '/:entityType/:entityId',
  validate(
    z.object({
      entityType: z.nativeEnum(RiskEntityType),
      entityId: z.coerce.number().int().positive(),
    }),
    'params',
  ),
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.params as unknown as {
      entityType: RiskEntityType
      entityId: number
    }

    const [score, signals, history] = await Promise.all([
      latestScore(entityType, entityId),
      collectSignals(entityType, entityId),
      prisma.riskScore.findMany({
        where: { entityType, entityId },
        orderBy: { computedAt: 'desc' },
        take: 20,
        select: { score: true, band: true, computedAt: true },
      }),
    ])

    if (!score) throw notFound('This entity has not been scored yet')

    res.json({
      entityType,
      entityId,
      score: score.score,
      band: score.band,
      factors: score.factors,
      modelVersion: score.modelVersion,
      computedAt: score.computedAt,
      signals,
      // Returned so a reader can check the arithmetic themselves.
      weights: FACTOR_SETS[entityType].map((f) => ({
        factor: f.key,
        label: f.label,
        weight: f.weight,
      })),
      history: history.reverse(),
    })
  }),
)

/** Recompute one entity on demand. */
riskRouter.post(
  '/:entityType/:entityId/recompute',
  validate(
    z.object({
      entityType: z.nativeEnum(RiskEntityType),
      entityId: z.coerce.number().int().positive(),
    }),
    'params',
  ),
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.params as unknown as {
      entityType: RiskEntityType
      entityId: number
    }
    res.json(await recomputeEntity(entityType, entityId))
  }),
)

/** Recompute everything. Useful after seeding or a bulk import. */
riskRouter.post(
  '/recompute',
  asyncHandler(async (req, res) => {
    const counts = await recomputeAll()
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'risk.recomputed_all',
        entityType: 'system',
        entityId: '0',
        payload: counts,
        actorId: req.user!.id,
        actorLabel: req.user!.fullName,
        source: 'grie',
      }),
    )
    res.json({ recomputed: counts, modelVersion: MODEL_VERSION })
  }),
)

/** Act on a flag. This is the human decision GRIE exists to prompt. */
riskRouter.post(
  '/flags/:id/review',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      status: z.enum([ReviewStatus.ACKNOWLEDGED, ReviewStatus.ACTIONED, ReviewStatus.DISMISSED]),
      note: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { status, note } = req.body as { status: ReviewStatus; note?: string }
    const actor = req.user!

    const flag = await prisma.riskFlag.findUnique({ where: { id } })
    if (!flag) throw notFound('That flag does not exist')

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.riskFlag.update({
        where: { id },
        data: { status, reviewNote: note ?? null, reviewedById: actor.id, reviewedAt: new Date() },
      })
      await audit.record(tx, {
        action: 'risk.flag_reviewed',
        entityType: flag.entityType.toLowerCase(),
        entityId: flag.entityId,
        payload: { flagId: id, status, note: note ?? null, score: flag.score },
        actorId: actor.id,
        actorLabel: actor.fullName,
        source: 'grie',
      })
      return saved
    })

    res.json(updated)
  }),
)
