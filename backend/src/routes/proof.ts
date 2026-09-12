import { readFile } from 'node:fs/promises'
import { Router, type ErrorRequestHandler, type Response } from 'express'
import { ProofOutcome, Role } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { storedPath, uploadProof } from '../middleware/upload.js'
import * as audit from '../services/audit.js'
import { readExif } from '../services/exif.js'
import { assess, save, withCitizenVerdict, type Assessment } from '../services/proof.js'
import { identify } from '../services/proofImage.js'
import { normaliseCode, stateOf } from '../services/workOrder.js'
import { AppError, asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'

/**
 * Photographs sent back from a job, and what they are taken to prove. Layer 4.
 *
 * This router is mounted *before* Layer 1's work-order router, on the same
 * path, and takes only the multipart form of the completion request — the one
 * carrying photographs. A submission without them falls through to Layer 1
 * untouched. That is what keeps the layer removable: delete this mount and the
 * crew page still works, exactly as it did before Layer 4 existed, and Layer 1's
 * file never learns a Layer 4 word.
 */
export const proofRouter: Router = Router()

const MAX_NOTE = 1000

function assessmentView(proof: { score: number; checks: unknown; outcome: ProofOutcome }) {
  return { score: proof.score, outcome: proof.outcome, checks: proof.checks }
}

/**
 * Send a stored photograph, or say it is gone.
 *
 * A row whose file is missing is a 404 rather than a crash: uploads live on a
 * disk this process does not own, and a wiped volume must not turn every
 * verification page into an error.
 */
async function sendPhoto(res: Response, photo: { storedName: string; mimeType: string }) {
  let bytes: Buffer
  try {
    bytes = await readFile(storedPath(photo.storedName))
  } catch {
    throw notFound('That photograph is no longer stored')
  }
  // Helmet defaults every response to same-origin embedding, which is right for
  // the API and wrong for an image the app on another port has to show. Relaxed
  // here only: who may fetch it is already decided above.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.type(photo.mimeType).send(bytes)
}

/** What the crew is told, in the order it matters to them. */
const CREW_MESSAGE: Record<ProofOutcome, string> = {
  [ProofOutcome.REJECTED]:
    'This was not recorded as finished. See what failed below, take a new photograph at the site, and send it again.',
  [ProofOutcome.NEEDS_CITIZEN]:
    'Recorded. The resident who reported it has been asked to confirm the work.',
  [ProofOutcome.NEEDS_OFFICER]: 'Recorded. The officer will check it.',
  [ProofOutcome.CONFIRMED]: 'Recorded and confirmed.',
}

// ---------------------------------------------------------------------------
// The crew — no account, the code is the credential
// ---------------------------------------------------------------------------

/**
 * Report a job done, with photographs.
 *
 * The crew's word plus evidence. The checks run before anything is marked
 * finished, and a submission that fails them is not a completion: nothing is
 * attached to the job's record as done, and the crew is told which check failed
 * so they can put it right while they are still standing there.
 */
proofRouter.post(
  '/work-orders/:code/complete',
  (req, _res, next) => {
    // Only the form with files is Layer 4's. Everything else is Layer 1's.
    if (!req.is('multipart/form-data')) return next('router')
    next()
  },
  uploadProof,
  asyncHandler(async (req, res) => {
    const code = normaliseCode(String(req.params.code))
    const order = await prisma.workOrder.findUnique({
      where: { code },
      include: { request: { select: { srNumber: true } } },
    })
    if (!order) throw notFound('That code does not match any job.')

    const state = stateOf(order)
    if (state === 'COMPLETED') throw badRequest('This job has already been reported done')
    if (state === 'CANCELLED') throw badRequest('This job was withdrawn by the officer')
    if (state === 'EXPIRED') throw badRequest('This code has expired — ask the officer for a new one')

    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw badRequest('Attach at least one photograph of the finished work')

    const note = String((req.body as { note?: string }).note ?? '').slice(0, MAX_NOTE) || null

    for (const file of files) {
      const bytes = await readFile(file.path)
      const identity = await identify(bytes)
      const exif = readExif(bytes)
      await prisma.workPhoto.create({
        data: {
          workOrderId: order.id,
          storedName: file.filename,
          mimeType: file.mimetype,
          bytes: file.size,
          sha256: identity.sha256,
          dHash: identity.dHash,
          width: identity.width,
          height: identity.height,
          capturedAt: exif.capturedAt,
          exifLat: exif.latitude,
          exifLng: exif.longitude,
        },
      })
    }

    const assessment = await assess(prisma, order.id)
    const accepted = assessment.outcome !== ProofOutcome.REJECTED

    await prisma.$transaction(async (tx) => {
      await save(tx, order.id, assessment)
      if (accepted) {
        await tx.workOrder.update({
          where: { id: order.id },
          data: { completedAt: new Date(), completionNote: note },
        })
      }
      await audit.record(tx, {
        action: accepted ? 'work_order.completed' : 'work_order.proof_refused',
        entityType: 'work_order',
        entityId: order.id,
        payload: {
          code: order.code,
          srNumber: order.request.srNumber,
          photographs: files.length,
          score: assessment.score,
          outcome: assessment.outcome,
          note,
        },
        // No actor: the crew has no account, and the label says how it was done.
        actorId: null,
        actorLabel: `field crew, by work-order code ${order.code}`,
      })
    })

    res.json({
      ok: accepted,
      state: accepted ? 'COMPLETED' : state,
      message: CREW_MESSAGE[assessment.outcome],
      proof: assessmentView(assessment),
      photos: files.map((f) => f.filename),
    })
  }),
)

/** The verdict on a job, to whoever holds its code. */
proofRouter.get(
  '/work-orders/:code/proof',
  asyncHandler(async (req, res) => {
    const code = normaliseCode(String(req.params.code))
    const order = await prisma.workOrder.findUnique({
      where: { code },
      include: { proof: true, photos: { orderBy: { id: 'asc' } } },
    })
    if (!order) throw notFound('That code does not match any job.')
    res.json({
      code: order.code,
      proof: order.proof ? assessmentView(order.proof) : null,
      message: order.proof ? CREW_MESSAGE[order.proof.outcome] : null,
      photos: order.photos.map((p) => ({ storedName: p.storedName, uploadedAt: p.uploadedAt })),
      // The officer's own sentence, once they have written one. Refusing
      // requires a reason precisely so the crew is sent it; storing it and never
      // showing it would leave them to guess, and guess wrong twice.
      decision:
        order.proof?.decidedAt != null
          ? {
              outcome: order.proof.outcome,
              note: order.proof.decisionNote,
              decidedAt: order.proof.decidedAt,
            }
          : null,
    })
  }),
)

/**
 * A photograph, to the crew that sent it.
 *
 * Addressed by the job's code, like everything else on that surface. The
 * photograph belongs to the job, so holding the code is the same authority that
 * created it.
 */
proofRouter.get(
  '/work-orders/:code/photo/:storedName',
  asyncHandler(async (req, res) => {
    const photo = await prisma.workPhoto.findUnique({
      where: { storedName: String(req.params.storedName) },
      include: { workOrder: { select: { code: true } } },
    })
    if (!photo || photo.workOrder.code !== normaliseCode(String(req.params.code))) {
      throw notFound('No such photograph')
    }
    await sendPhoto(res, photo)
  }),
)

// ---------------------------------------------------------------------------
// The resident who reported it
// ---------------------------------------------------------------------------

const verdictSchema = z.object({ confirmed: z.boolean() })

/**
 * The resident's answer, which outranks every automated check.
 *
 * Only the person who filed the request may give it. They can see the street;
 * the checks can only see metadata.
 */
proofRouter.post(
  '/proof/:workOrderId/citizen',
  authenticate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.workOrderId)
    if (!Number.isInteger(id)) throw badRequest('Invalid work order')
    const parsed = verdictSchema.safeParse(req.body)
    if (!parsed.success) throw badRequest('Say whether the work was done', parsed.error.flatten())

    const order = await prisma.workOrder.findUnique({
      where: { id },
      include: { proof: true, request: { select: { citizenId: true, srNumber: true } } },
    })
    if (!order?.proof) throw notFound('That job has no submission to judge')
    if (order.request.citizenId !== req.user!.id) {
      throw forbidden('Only the person who reported this problem can answer')
    }
    if (order.proof.outcome !== ProofOutcome.NEEDS_CITIZEN) {
      throw badRequest('This submission is no longer waiting on you')
    }

    const updated = withCitizenVerdict(
      { score: order.proof.score, checks: order.proof.checks as unknown as Assessment['checks'], outcome: order.proof.outcome },
      parsed.data.confirmed,
    )

    await prisma.$transaction(async (tx) => {
      await tx.workProof.update({
        where: { workOrderId: order.id },
        data: {
          score: updated.score,
          checks: updated.checks as unknown as object,
          outcome: updated.outcome,
          citizenVerdict: parsed.data.confirmed,
          citizenAt: new Date(),
        },
      })
      await audit.record(tx, {
        action: 'work_order.citizen_verdict',
        entityType: 'work_order',
        entityId: order.id,
        payload: { srNumber: order.request.srNumber, confirmed: parsed.data.confirmed },
        actorId: req.user!.id,
        actorLabel: req.user!.name,
      })
    })
    res.json(assessmentView(updated))
  }),
)

/**
 * What, if anything, this resident is being asked about their own request.
 *
 * Answers for the signed-in reporter only, and only while the question stands.
 * Everyone else — including an officer looking at the same request — gets
 * nothing here: this endpoint exists to put a question on one person's screen.
 */
proofRouter.get(
  '/proof/request/:srNumber',
  authenticate,
  asyncHandler(async (req, res) => {
    const srNumber = String(req.params.srNumber).trim().toUpperCase()
    const order = await prisma.workOrder.findFirst({
      where: {
        request: { srNumber, citizenId: req.user!.id },
        proof: { outcome: ProofOutcome.NEEDS_CITIZEN },
      },
      include: { proof: true, photos: { orderBy: { id: 'asc' } } },
      orderBy: { completedAt: 'desc' },
    })
    if (!order?.proof) {
      res.json(null)
      return
    }
    res.json({
      workOrderId: order.id,
      srNumber,
      completedAt: order.completedAt,
      completionNote: order.completionNote,
      photos: order.photos.map((p) => ({ storedName: p.storedName, uploadedAt: p.uploadedAt })),
      proof: assessmentView(order.proof),
    })
  }),
)

// ---------------------------------------------------------------------------
// The officer, when a person is genuinely needed
// ---------------------------------------------------------------------------

/**
 * What is waiting on this officer.
 *
 * Deliberately short. A submission reaches this queue only when the resident
 * disputed it, or when the proof was weak and nobody vouched for it within the
 * grace period. Everything else is settled without an officer, which is the
 * point of the layer.
 */
proofRouter.get(
  '/proof/queue',
  authenticate,
  requireRole(Role.OFFICER, Role.SUPERVISOR),
  asyncHandler(async (req, res) => {
    const user = req.user!
    const orders = await prisma.workOrder.findMany({
      where: {
        proof: { outcome: ProofOutcome.NEEDS_OFFICER },
        request:
          user.role === Role.OFFICER
            ? { assignedOfficerId: user.id }
            : { agencyId: user.agencyId ?? -1 },
      },
      include: {
        proof: true,
        photos: { orderBy: { id: 'asc' } },
        request: {
          select: {
            id: true,
            srNumber: true,
            status: true,
            address: true,
            type: { select: { name: true } },
            orgUnit: { select: { code: true, name: true } },
            assignedOfficer: { select: { name: true, isSynthetic: true } },
          },
        },
      },
      orderBy: { completedAt: 'asc' },
    })

    res.json({
      rows: orders.map((order) => ({
        workOrderId: order.id,
        code: order.code,
        completedAt: order.completedAt,
        completionNote: order.completionNote,
        request: order.request,
        proof: order.proof ? assessmentView(order.proof) : null,
        citizenVerdict: order.proof?.citizenVerdict ?? null,
        photos: order.photos.map((p) => ({ storedName: p.storedName, uploadedAt: p.uploadedAt })),
      })),
    })
  }),
)

/** A photograph, to the people in this system entitled to see it. */
proofRouter.get(
  '/proof/photo/:storedName',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = req.user!
    const photo = await prisma.workPhoto.findUnique({
      where: { storedName: String(req.params.storedName) },
      include: {
        workOrder: {
          select: { request: { select: { citizenId: true, agencyId: true, assignedOfficerId: true } } },
        },
      },
    })
    if (!photo) throw notFound('No such photograph')

    const request = photo.workOrder.request
    const allowed =
      user.role === Role.ADMIN ||
      (user.role === Role.OFFICER && request.assignedOfficerId === user.id) ||
      ((user.role === Role.SUPERVISOR || user.role === Role.COMMISSIONER) &&
        request.agencyId === user.agencyId) ||
      request.citizenId === user.id
    if (!allowed) throw forbidden('This photograph is not yours to see')

    await sendPhoto(res, photo)
  }),
)

const decisionSchema = z.object({
  accept: z.boolean(),
  note: z.string().trim().max(MAX_NOTE).optional(),
})

/**
 * The officer's decision, when it comes to that.
 *
 * Accepting records the work as proven; the request is closed separately,
 * through the ordinary status change, because closing it is a statement about
 * the problem and not about the photograph. Refusing sends the job back to the
 * crew: the work order stops being complete, and the reason travels with it.
 */
proofRouter.post(
  '/proof/:workOrderId/decide',
  authenticate,
  requireRole(Role.OFFICER, Role.SUPERVISOR),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.workOrderId)
    if (!Number.isInteger(id)) throw badRequest('Invalid work order')
    const parsed = decisionSchema.safeParse(req.body)
    if (!parsed.success) throw badRequest('Say whether the work is accepted', parsed.error.flatten())
    const { accept, note } = parsed.data
    if (!accept && !note) throw badRequest('Say why it was refused — the crew is sent this sentence')

    const user = req.user!
    const order = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        proof: true,
        request: { select: { srNumber: true, agencyId: true, assignedOfficerId: true } },
      },
    })
    if (!order?.proof) throw notFound('That job has no submission to decide')

    const mine =
      user.role === Role.OFFICER
        ? order.request.assignedOfficerId === user.id
        : order.request.agencyId === user.agencyId
    if (!mine) throw forbidden('That job is not yours to decide')
    if (order.proof.outcome === ProofOutcome.CONFIRMED) throw badRequest('That submission is already settled')

    await prisma.$transaction(async (tx) => {
      await tx.workProof.update({
        where: { workOrderId: order.id },
        data: {
          outcome: accept ? ProofOutcome.CONFIRMED : ProofOutcome.REJECTED,
          decidedById: user.id,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        },
      })
      if (!accept) {
        // Refused work is not finished work: the job goes back to the crew.
        await tx.workOrder.update({ where: { id: order.id }, data: { completedAt: null } })
      }
      await audit.record(tx, {
        action: accept ? 'work_order.proof_accepted' : 'work_order.proof_rejected',
        entityType: 'work_order',
        entityId: order.id,
        payload: { srNumber: order.request.srNumber, note: note ?? null },
        actorId: user.id,
        actorLabel: user.name,
      })
    })

    res.json({ ok: true, outcome: accept ? ProofOutcome.CONFIRMED : ProofOutcome.REJECTED })
  }),
)

/** Multer's own errors, said in words a crew can act on. */
const uploadErrors: ErrorRequestHandler = (err, _req, _res, next) => {
  const code = (err as { code?: string } | null)?.code
  if (code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'That photograph is too large — 12 MB at most'))
  if (code === 'LIMIT_FILE_COUNT') return next(new AppError(400, 'Three photographs at most'))
  next(err)
}
proofRouter.use(uploadErrors)
