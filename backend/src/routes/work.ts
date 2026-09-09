/**
 * The street worker's portal. No account, no password, no rank.
 *
 * This is the only unauthenticated write path in the system, so it is built
 * narrow on purpose: a code addresses exactly one job, it expires, it reveals
 * only what somebody standing at the site would already know, and it can do
 * precisely one thing — attach proof to that job.
 *
 * What it deliberately does *not* expose: the citizen's name, their phone, the
 * other complaints on the street. A code that leaks should cost the authority a
 * junk submission, not a resident's privacy.
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Router } from 'express'
import { IdentityAssurance, WorkOrderStatus } from '@prisma/client'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { proofKind, uploadProof, photoUrl } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { readExif } from '../services/exif.js'
import { assessSubmission, saveVerification } from '../services/verification.js'
import { isOpenOrder, normaliseCode, workerLink } from '../services/workOrder.js'
import { asyncHandler, badRequest, notFound, unprocessable } from '../utils/http.js'

export const workRouter: Router = Router()

const codeParam = z.object({ code: z.string().min(4).max(24) })

/**
 * A very small rate limit, in memory.
 *
 * Enough to stop somebody walking the code space from one machine. A real
 * deployment would put this at the edge; keeping a version of it here means the
 * open endpoint is never completely unguarded in development either.
 */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 30

/**
 * Off only for the traffic simulator, and never in production.
 *
 * Every simulated crew member reaches this endpoint from the same address, so a
 * run of any size trips the limit inside the first minute and the register
 * fills with jobs nobody ever reported done — the limiter behaving correctly
 * while producing a dataset that describes a system nobody used. The escape
 * hatch is explicit, env-gated, and refuses to apply when NODE_ENV is
 * production, so the public surface is never accidentally left open.
 */
const RATE_LIMIT_DISABLED =
  process.env.SIM_RELAX_RATE_LIMIT === '1' && process.env.NODE_ENV !== 'production'

function rateLimited(key: string): boolean {
  if (RATE_LIMIT_DISABLED) return false

  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_PER_WINDOW
}

/**
 * Binding a code to the phone that opened it.
 *
 * There is no account to authenticate against here and there never will be —
 * the people doing this work are contractual and rotate weekly. What can be
 * established cheaply is *continuity*: the device that opened the slip is the
 * device that sent the work back. The server issues the token so it cannot be
 * guessed, and stores only its hash, the way a session token is handled.
 *
 * This is never a gate. A worker standing over a finished job must not be
 * turned away because they switched phones or cleared their browser — the
 * submission is accepted either way and simply carries a weaker assurance level
 * for the officer to see.
 */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/** Constant-time-ish comparison. Both sides are fixed-length hex digests. */
function sameToken(token: string | undefined, storedHash: string | null): boolean {
  if (!token || !storedHash) return false
  const a = Buffer.from(hashToken(token))
  const b = Buffer.from(storedHash)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** Load a job by code, or explain in plain words why it cannot be worked. */
async function loadOrder(rawCode: string) {
  const code = normaliseCode(rawCode)

  const order = await prisma.workOrder.findUnique({
    where: { code },
    include: {
      crew: { select: { id: true, fullName: true, trade: true } },
      issuedBy: { select: { fullName: true, phone: true } },
      complaint: {
        include: {
          category: { select: { name: true, nameHi: true, icon: true } },
          department: { select: { name: true, icon: true } },
          sector: { select: { number: true, name: true } },
        },
      },
      submissions: { include: { files: true }, orderBy: { submittedAt: 'desc' } },
      verification: true,
    },
  })

  if (!order) throw notFound('That code does not match any job. Check the digits and try again.')
  return order
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>

/**
 * What a worker is shown.
 *
 * Enough to find the place and know what is being asked. Nothing about who
 * reported it.
 */
function publicJob(order: LoadedOrder) {
  const expired = order.expiresAt.getTime() < Date.now()

  return {
    code: order.code,
    status: order.status,
    expired,
    /** Whether anything can still be submitted against this code. */
    acceptsSubmission: isOpenOrder(order.status) && !expired,
    job: {
      title: order.complaint.title,
      what: order.complaint.description,
      instructions: order.instructions,
      category: order.complaint.category,
      department: order.complaint.department,
      sector: order.complaint.sector,
      // Where to go. The citizen's landmark is the useful part of an address in
      // Noida, and it is about the place rather than the person.
      landmark: order.complaint.landmark,
      address: order.complaint.address,
      latitude: order.complaint.latitude,
      longitude: order.complaint.longitude,
      /** The complaint photo, so the worker knows what they are looking for. */
      referencePhotoUrl: order.complaint.photoUrl,
      priority: order.complaint.priority,
      dueAt: order.complaint.slaDueAt,
    },
    assignedTo: order.crew ? { fullName: order.crew.fullName, trade: order.crew.trade } : null,
    // Who to ring when the job is not what the slip says.
    supervisor: { fullName: order.issuedBy.fullName, phone: order.issuedBy.phone },
    issuedAt: order.issuedAt,
    expiresAt: order.expiresAt,
    submissions: order.submissions.map((s) => ({
      id: s.id,
      note: s.note,
      submittedAt: s.submittedAt,
      files: s.files.map((f) => ({ id: f.id, url: f.url, kind: f.kind })),
    })),
    /**
     * The score and its working, shown to the worker too. Somebody whose
     * submission was refused is entitled to know which check failed rather than
     * being told simply that it was not accepted.
     */
    verification: order.verification
      ? {
          score: order.verification.score,
          outcome: order.verification.outcome,
          checks: order.verification.checks,
        }
      : null,
  }
}

/** Open a job by its code. */
workRouter.get(
  '/:code',
  validate(codeParam, 'params'),
  asyncHandler(async (req, res) => {
    if (rateLimited(req.ip ?? 'unknown')) {
      throw badRequest('Too many attempts. Wait a minute and try again.')
    }

    const order = await loadOrder(req.params.code!)
    const presented = typeof req.query.device === 'string' ? req.query.device : undefined

    // First open marks the job as picked up, which is what tells the officer
    // the slip reached somebody without anyone having to report in.
    if (order.status === WorkOrderStatus.ISSUED) {
      await prisma.workOrder.update({
        where: { id: order.id },
        data: { status: WorkOrderStatus.OPENED, openedAt: new Date() },
      })
      order.status = WorkOrderStatus.OPENED
    }

    /**
     * Hand out a device token the first time this code is opened, and only
     * then. A second phone opening the same slip is not refused — it simply
     * never receives a token, so whatever it submits is recorded at NONE.
     */
    let deviceToken: string | undefined
    if (!order.boundDeviceHash) {
      deviceToken = randomBytes(24).toString('hex')
      await prisma.workOrder.update({
        where: { id: order.id },
        data: { boundDeviceHash: hashToken(deviceToken), boundAt: new Date() },
      })
      order.boundDeviceHash = hashToken(deviceToken)
    } else if (sameToken(presented, order.boundDeviceHash)) {
      // Same phone coming back — hand the token straight back so a cleared tab
      // does not silently downgrade the submission that follows.
      deviceToken = presented
    }

    res.json({
      ...publicJob(order),
      deviceToken,
      /** What this device's submission would currently be recorded as. */
      assurance: deviceToken ? IdentityAssurance.DEVICE_BOUND : IdentityAssurance.NONE,
    })
  }),
)

/**
 * Send back what was done.
 *
 * Files are hashed and read for EXIF as they land, because both are evidence
 * and both are cheapest to capture here. The assessment runs immediately so the
 * worker gets an answer while they are still standing at the site — if the
 * proof is refused they can retake it, rather than finding out days later.
 */
workRouter.post(
  '/:code/submit',
  validate(codeParam, 'params'),
  uploadProof,
  asyncHandler(async (req, res) => {
    if (rateLimited(`submit:${req.ip ?? 'unknown'}`)) {
      throw badRequest('Too many attempts. Wait a minute and try again.')
    }

    const order = await loadOrder(req.params.code!)

    if (order.expiresAt.getTime() < Date.now()) {
      throw unprocessable('This code has expired. Ask your officer for a new one.')
    }
    if (!isOpenOrder(order.status)) {
      throw unprocessable('This job has already been submitted.')
    }

    const uploaded = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>
    const files = uploaded.files ?? []
    const selfie = uploaded.selfie?.[0]

    const body = z
      .object({
        note: z.string().max(2000).optional(),
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
        /** Issued by this endpoint on first open. See hashToken. */
        device: z.string().max(128).optional(),
      })
      .parse(req.body)

    if (files.length === 0 && !body.note) {
      throw badRequest('Add a photo of the finished work, or write what you did.')
    }

    /**
     * How much the name on this job is worth.
     *
     * Deliberately computed and stored rather than enforced: the officer who
     * inspects the work is shown the level and can weigh it themselves. Nobody
     * is turned away for arriving on a different phone.
     */
    const assurance = sameToken(body.device, order.boundDeviceHash)
      ? IdentityAssurance.DEVICE_BOUND
      : IdentityAssurance.NONE

    // Hash and read metadata before the transaction: reading five files off
    // disk should not hold a database transaction open.
    const prepared = await Promise.all(
      [...files, ...(selfie ? [selfie] : [])].map(async (file) => {
        const bytes = await readFile(file.path)
        const exif = file.mimetype.startsWith('image/')
          ? readExif(bytes)
          : { capturedAt: null, latitude: null, longitude: null }

        return {
          url: photoUrl(file.filename),
          kind: proofKind(file.mimetype),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          contentHash: createHash('sha256').update(bytes).digest('hex'),
          capturedAt: exif.capturedAt,
          exifLat: exif.latitude,
          exifLon: exif.longitude,
          isSelfie: file.fieldname === 'selfie',
        }
      }),
    )

    await prisma.$transaction(async (tx) => {
      await tx.workSubmission.create({
        data: {
          workOrderId: order.id,
          note: body.note || null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          identityAssurance: assurance,
          files: { create: prepared },
        },
      })

      await tx.workOrder.update({
        where: { id: order.id },
        data: { status: WorkOrderStatus.SUBMITTED, submittedAt: new Date() },
      })

      // The actor is a code, not a person: recorded as the crew member the
      // officer assigned it to, which is the truthful attribution available.
      await audit.record(tx, {
        action: 'work.submitted',
        entityType: 'complaint',
        entityId: order.complaintId,
        payload: {
          code: order.code,
          files: files.length,
          selfie: selfie != null,
          crewId: order.crewId,
          identityAssurance: assurance,
        },
        actorId: null,
        actorLabel: order.crew?.fullName ?? `Work order ${order.code}`,
        source: 'system',
      })
    })

    const result = await assessSubmission(prisma, order.id)
    await saveVerification(prisma, order.id, result)

    await prisma.$transaction(async (tx) => {
      if (result.outcome === 'REJECTED') {
        // Refused proof does not close the job — the work order stays open so
        // the same code can be used to send something better.
        await tx.workOrder.update({
          where: { id: order.id },
          data: { status: WorkOrderStatus.OPENED, submittedAt: null },
        })
        return
      }

      // The complaint now waits on the citizen rather than on an officer.
      await tx.complaint.update({
        where: { id: order.complaintId },
        data: { status: 'AWAITING_VERIFICATION' },
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: order.complaintId,
          fromStatus: order.complaint.status,
          toStatus: 'AWAITING_VERIFICATION',
          note: `Work submitted from the field against ${order.code}. Automated checks scored ${result.score}/100.`,
        },
      })

      await tx.notification.create({
        data: {
          userId: order.complaint.citizenId,
          title: `Work reported done: ${order.complaint.referenceNo}`,
          body: 'Please check and tell us whether it is actually fixed. Your answer is what closes it.',
          link: `/complaints/${order.complaintId}`,
        },
      })
    })

    res.status(201).json({
      accepted: result.outcome !== 'REJECTED',
      score: result.score,
      outcome: result.outcome,
      checks: result.checks,
      message:
        result.outcome === 'REJECTED'
          ? 'This could not be accepted as proof. Read the checks below and send a fresh photo taken at the site.'
          : 'Thank you. The resident who reported this has been asked to confirm it.',
    })
  }),
)

/** The QR image for a code, so an officer can show it on their phone. */
workRouter.get(
  '/:code/qr.svg',
  validate(codeParam, 'params'),
  asyncHandler(async (req, res) => {
    const code = normaliseCode(req.params.code!)
    const order = await prisma.workOrder.findUnique({ where: { code }, select: { id: true } })
    if (!order) throw notFound('That code does not match any job')

    const { qrSvg } = await import('../services/qr.js')
    res.type('image/svg+xml').send(await qrSvg(workerLink(env.APP_URL, code)))
  }),
)
