import { Router } from 'express'
import { RequestStatus, Role } from '@prisma/client'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { qrDataUrl } from '../services/qr.js'
import {
  CODE_TTL_DAYS,
  generateCode,
  normaliseCode,
  stateOf,
  workerLink,
} from '../services/workOrder.js'
import { AppError, asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'

/**
 * Work orders. Layer 1 — nothing here exists in NYC 311.
 *
 * Two audiences on one path. Issuing and cancelling are an officer's, behind a
 * session. Opening a job and reporting it done belong to a crew with no account,
 * addressed by the code alone — the only unauthenticated writes in Layer 1, and
 * built narrow for that reason: a code reaches exactly one job, it expires, it
 * shows only what someone standing at the site would already know, and the one
 * thing it can do is say the work is finished.
 *
 * What it never shows: who reported the problem. A code that leaks should cost
 * a junk completion report, not a resident's privacy.
 */
export const workOrdersRouter: Router = Router()

const DAY_MS = 86_400_000

/**
 * A small rate limit, in memory, on the open endpoints.
 *
 * Enough to stop one machine walking the code space. A real deployment puts
 * this at the edge; keeping a version here means the open endpoint is never
 * completely unguarded, including in development.
 */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 30

function rateLimited(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_PER_WINDOW
}

// ---------------------------------------------------------------------------
// Issuing — the accountable officer, signed in
// ---------------------------------------------------------------------------

const issueSchema = z.object({
  requestId: z.number().int().positive(),
  instructions: z.string().max(1000).optional(),
})

workOrdersRouter.post(
  '/',
  authenticate,
  requireRole(Role.OFFICER),
  validate(issueSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof issueSchema>
    const officer = req.user!

    const request = await prisma.serviceRequest.findUnique({ where: { id: body.requestId } })
    if (!request) throw notFound('No such request')
    // Only the person who answers for a request sends a crew to it. A work order
    // issued by someone else would put a job on the street nobody is accountable
    // for — the exact gap Layer 1 exists to close.
    if (request.assignedOfficerId !== officer.id) {
      throw forbidden('Only the officer this request is assigned to can issue a work order for it')
    }
    if (request.status === RequestStatus.CLOSED) {
      throw badRequest('That request is closed')
    }

    const issuedAt = new Date()
    const order = await prisma.$transaction(async (tx) => {
      const code = await generateCode(tx)
      const created = await tx.workOrder.create({
        data: {
          requestId: request.id,
          issuedById: officer.id,
          code,
          instructions: body.instructions ?? null,
          issuedAt,
          expiresAt: new Date(issuedAt.getTime() + CODE_TTL_DAYS * DAY_MS),
        },
      })
      await audit.record(tx, {
        action: 'work_order.issued',
        entityType: 'work_order',
        entityId: created.id,
        payload: { code, requestId: request.id, srNumber: request.srNumber },
        actorId: officer.id,
        actorLabel: officer.name,
      })
      return created
    })

    const link = workerLink(env.APP_URL, order.code)
    res.status(201).json({
      id: order.id,
      code: order.code,
      link,
      // Returned with the order rather than fetched after it, so the officer
      // can show or print it the moment the job exists.
      qrDataUrl: await qrDataUrl(link),
      issuedAt: order.issuedAt,
      expiresAt: order.expiresAt,
      state: stateOf(order),
    })
  }),
)

workOrdersRouter.post(
  '/:code/cancel',
  authenticate,
  requireRole(Role.OFFICER),
  asyncHandler(async (req, res) => {
    const code = normaliseCode(String(req.params.code))
    const order = await prisma.workOrder.findUnique({ where: { code } })
    if (!order) throw notFound('No work order with that code')
    if (order.issuedById !== req.user!.id) throw forbidden('Only the issuing officer can cancel it')
    if (stateOf(order) !== 'ISSUED') throw badRequest('That work order can no longer be cancelled')

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({ where: { id: order.id }, data: { cancelledAt: new Date() } })
      await audit.record(tx, {
        action: 'work_order.cancelled',
        entityType: 'work_order',
        entityId: order.id,
        payload: { code },
        actorId: req.user!.id,
        actorLabel: req.user!.name,
      })
    })
    res.json({ ok: true })
  }),
)

/**
 * The QR again, for a job already out — to the officer who issued it only.
 *
 * Anyone holding the code can open the job, so the image reveals nothing the
 * code does not. It is kept behind the issuer's session anyway so that this path
 * cannot become an unauthenticated oracle that answers one way for a real code
 * and another for an invented one.
 */
workOrdersRouter.get(
  '/:code/qr',
  authenticate,
  requireRole(Role.OFFICER),
  asyncHandler(async (req, res) => {
    const code = normaliseCode(String(req.params.code))
    const order = await prisma.workOrder.findUnique({ where: { code } })
    if (!order || order.issuedById !== req.user!.id) {
      throw notFound('No work order of yours has that code')
    }
    const link = workerLink(env.APP_URL, order.code)
    res.json({ code: order.code, link, qrDataUrl: await qrDataUrl(link), state: stateOf(order) })
  }),
)

// ---------------------------------------------------------------------------
// The crew — no account, the code is the credential
// ---------------------------------------------------------------------------

async function loadByCode(raw: string) {
  const order = await prisma.workOrder.findUnique({
    where: { code: normaliseCode(raw) },
    include: {
      issuedBy: { select: { name: true, isSynthetic: true } },
      request: {
        select: {
          srNumber: true,
          address: true,
          latitude: true,
          longitude: true,
          type: { select: { name: true } },
          descriptor: { select: { name: true } },
          orgUnit: { select: { code: true, name: true } },
        },
      },
    },
  })
  if (!order) throw notFound('That code does not match any job. Check the characters and try again.')
  return order
}

workOrdersRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    if (rateLimited(req.ip ?? 'unknown')) throw new AppError(429, 'Too many attempts — wait a minute')
    const order = await loadByCode(String(req.params.code))
    res.json({
      code: order.code,
      state: stateOf(order),
      issuedAt: order.issuedAt,
      expiresAt: order.expiresAt,
      completedAt: order.completedAt,
      instructions: order.instructions,
      job: {
        srNumber: order.request.srNumber,
        what: order.request.type.name,
        detail: order.request.descriptor?.name ?? null,
        address: order.request.address,
        board: order.request.orgUnit,
        latitude: order.request.latitude,
        longitude: order.request.longitude,
      },
      issuedBy: { name: order.issuedBy.name, isSynthetic: order.issuedBy.isSynthetic },
    })
  }),
)

const completeSchema = z.object({ note: z.string().max(1000).optional() })

/**
 * The crew reports the job done.
 *
 * This records the report and does not close the request. The officer does
 * that, through the ordinary status change, because "the crew says it is done"
 * and "it is done" are different claims, and Layer 1 has no way to verify the
 * second — that is Layer 4's photo verification. Closing on the crew's word
 * would let an unauthenticated code change the public record.
 */
workOrdersRouter.post(
  '/:code/complete',
  validate(completeSchema),
  asyncHandler(async (req, res) => {
    if (rateLimited(req.ip ?? 'unknown')) throw new AppError(429, 'Too many attempts — wait a minute')
    const order = await loadByCode(String(req.params.code))
    const state = stateOf(order)
    if (state === 'COMPLETED') throw badRequest('This job has already been reported done')
    if (state === 'CANCELLED') throw badRequest('This job was withdrawn by the officer')
    if (state === 'EXPIRED') throw badRequest('This code has expired — ask the officer for a new one')

    const note = (req.body as z.infer<typeof completeSchema>).note ?? null
    const completedAt = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: order.id },
        data: { completedAt, completionNote: note },
      })
      await audit.record(tx, {
        action: 'work_order.completed',
        entityType: 'work_order',
        entityId: order.id,
        payload: { code: order.code, srNumber: order.request.srNumber, note },
        // No actor: the crew has no account. The label says how it was done, so
        // the chain never implies a person it cannot name.
        actorId: null,
        actorLabel: `field crew, by work-order code ${order.code}`,
      })
    })

    res.json({ ok: true, state: 'COMPLETED', completedAt })
  }),
)
