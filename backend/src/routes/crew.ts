/**
 * The crew roll, and the work orders drawn from it.
 *
 * A Section Officer keeps a list of who works their sector and hands out jobs
 * against it. Officers above them can read the rolls beneath — a General
 * Manager asking "how many sweepers do we actually have in Zone II" is a
 * reasonable question the old model could only answer by counting user
 * accounts, which is exactly the fiction this replaces.
 */
import { Router } from 'express'
import {
  ComplaintStatus,
  Prisma,
  Rank,
  Trade,
  VerificationOutcome,
  WorkOrderStatus,
} from '@prisma/client'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireOfficer, requireSectionOfficer } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { OPEN_STATUSES } from '../services/gcce.js'
import { hasJurisdiction, isAuthorityWide, sectorsInScope } from '../services/hierarchy.js'
import { qrDataUrl } from '../services/qr.js'
import { CODE_TTL_DAYS, generateCode, workerLink } from '../services/workOrder.js'
import { asyncHandler, forbidden, notFound, unprocessable } from '../utils/http.js'
import { formBoolean } from '../utils/schema.js'

export const crewRouter: Router = Router()

crewRouter.use(authenticate, requireOfficer)

const idParam = z.object({ id: z.coerce.number().int().positive() })

/**
 * The crew an officer may see.
 *
 * A Section Officer sees their own roll. Anyone above sees every roll inside
 * their jurisdiction, which is what makes "the workers under me" answerable at
 * each tier of the chain.
 */
async function crewScope(
  actor: NonNullable<Express.Request['user']>,
): Promise<Prisma.CrewWhereInput> {
  if (actor.rank === Rank.SECTION_OFFICER) return { supervisorId: actor.id }
  if (isAuthorityWide(actor.rank)) return {}

  const sectors = await sectorsInScope(prisma, actor.id)
  return sectors === null ? {} : { sectorId: { in: sectors } }
}

const CREW_INCLUDE = {
  sector: { select: { id: true, number: true, name: true } },
  department: { select: { id: true, name: true, icon: true } },
  supervisor: { select: { id: true, fullName: true } },
} as const

/** Everyone working under the caller. */
crewRouter.get(
  '/',
  validate(
    z.object({
      sectorId: z.coerce.number().int().positive().optional(),
      trade: z.nativeEnum(Trade).optional(),
      includeInactive: formBoolean.default(false),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const { sectorId, trade, includeInactive } = req.query as unknown as {
      sectorId?: number
      trade?: Trade
      includeInactive: boolean
    }

    const where: Prisma.CrewWhereInput = { ...(await crewScope(actor)) }
    if (sectorId) where.sectorId = sectorId
    if (trade) where.trade = trade
    if (!includeInactive) where.isActive = true

    const crew = await prisma.crew.findMany({
      where,
      include: CREW_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    })

    // How much each of them is currently carrying, so an officer handing out a
    // job can see who is already busy.
    const live = await prisma.workOrder.groupBy({
      by: ['crewId'],
      where: {
        crewId: { in: crew.map((c) => c.id) },
        status: { in: [WorkOrderStatus.ISSUED, WorkOrderStatus.OPENED] },
      },
      _count: { _all: true },
    })

    res.json({
      items: crew.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        phone: c.phone,
        trade: c.trade,
        isActive: c.isActive,
        sector: c.sector,
        department: c.department,
        supervisor: c.supervisor,
        openJobs: live.find((l) => l.crewId === c.id)?._count._all ?? 0,
      })),
      /** Whether the caller may add to this roll, or is only reading it. */
      canManage: actor.rank === Rank.SECTION_OFFICER,
    })
  }),
)

const crewSchema = z.object({
  fullName: z.string().min(2).max(128),
  phone: z.string().max(20).nullable().optional(),
  trade: z.nativeEnum(Trade),
  sectorId: z.number().int().positive(),
  departmentId: z.number().int().positive(),
})

/**
 * Add somebody to the roll.
 *
 * Section Officer only, and only into their own patch. A crew member is a note
 * about who is working for you this week, not an account — there is no
 * password, no email, and nothing to sign in to.
 */
crewRouter.post(
  '/',
  requireSectionOfficer,
  validate(crewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof crewSchema>
    const actor = req.user!

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: body.departmentId,
      sectorId: body.sectorId,
    })
    if (!permitted) throw forbidden('You can only add crew to your own sector')

    const crew = await prisma.$transaction(async (tx) => {
      const created = await tx.crew.create({
        data: { ...body, supervisorId: actor.id },
        include: CREW_INCLUDE,
      })
      await audit.record(tx, {
        action: 'crew.added',
        entityType: 'crew',
        entityId: created.id,
        payload: { fullName: body.fullName, trade: body.trade, sectorId: body.sectorId },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return created
    })

    res.status(201).json(crew)
  }),
)

crewRouter.patch(
  '/:id',
  requireSectionOfficer,
  validate(idParam, 'params'),
  validate(crewSchema.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const changes = req.body as Record<string, unknown>
    const actor = req.user!

    const existing = await prisma.crew.findUnique({ where: { id } })
    if (!existing) throw notFound('That crew member is not on any roll')
    if (existing.supervisorId !== actor.id) {
      throw forbidden('Only the officer who keeps this roll can change it')
    }

    const crew = await prisma.$transaction(async (tx) => {
      const saved = await tx.crew.update({ where: { id }, data: changes, include: CREW_INCLUDE })
      await audit.record(tx, {
        action: 'crew.updated',
        entityType: 'crew',
        entityId: id,
        payload: { changes },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(crew)
  }),
)

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

const issueSchema = z.object({
  complaintId: z.number().int().positive(),
  crewId: z.number().int().positive().nullable().optional(),
  instructions: z.string().max(2000).optional(),
})

/**
 * Issue a job against a complaint.
 *
 * Produces a code, a link and a QR. The officer shows the QR, messages the
 * link, or reads the eight characters down a phone — all three reach the same
 * page, which is the point of using a code rather than an account.
 */
crewRouter.post(
  '/work-orders',
  requireSectionOfficer,
  validate(issueSchema),
  asyncHandler(async (req, res) => {
    const { complaintId, crewId, instructions } = req.body as z.infer<typeof issueSchema>
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      include: { category: true },
    })
    if (!complaint) throw notFound('That complaint does not exist')
    if (complaint.departmentId == null || complaint.sectorId == null) {
      throw unprocessable('This complaint has not been routed to a department and sector yet')
    }

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')

    if (!OPEN_STATUSES.includes(complaint.status)) {
      throw unprocessable('This complaint is already closed')
    }

    // One live code per complaint. Two open codes for the same job means two
    // crews turning up and neither knowing the other did it.
    const existing = await prisma.workOrder.findFirst({
      where: {
        complaintId,
        status: { in: [WorkOrderStatus.ISSUED, WorkOrderStatus.OPENED] },
        expiresAt: { gt: new Date() },
      },
    })
    if (existing) {
      throw unprocessable(
        `A job is already out for this complaint under code ${existing.code}. Cancel it before issuing another.`,
      )
    }

    let crew = null
    if (crewId != null) {
      crew = await prisma.crew.findUnique({ where: { id: crewId } })
      if (!crew) throw unprocessable('That person is not on your roll')
      if (!crew.isActive) throw unprocessable('That person is no longer on the roll')
      if (crew.sectorId !== complaint.sectorId) {
        throw unprocessable('That person works a different sector')
      }
    }

    const code = await generateCode(prisma)
    const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 86_400_000)

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.workOrder.create({
        data: {
          complaintId,
          crewId: crew?.id ?? null,
          code,
          instructions: instructions || null,
          issuedById: actor.id,
          expiresAt,
        },
      })

      await tx.complaint.update({
        where: { id: complaintId },
        data: { status: 'IN_PROGRESS' },
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId,
          fromStatus: complaint.status,
          toStatus: 'IN_PROGRESS',
          actorId: actor.id,
          note: crew
            ? `Work order ${code} issued to ${crew.fullName}.`
            : `Work order ${code} issued.`,
        },
      })

      await tx.notification.create({
        data: {
          userId: complaint.citizenId,
          title: `Work has started on ${complaint.referenceNo}`,
          body: 'A crew has been given this job. You will be asked to confirm once they report it done.',
          link: `/complaints/${complaintId}`,
        },
      })

      await audit.record(tx, {
        action: 'work_order.issued',
        entityType: 'complaint',
        entityId: complaintId,
        payload: { code, crewId: crew?.id ?? null, expiresAt: expiresAt.toISOString() },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return created
    })

    const link = workerLink(env.APP_URL, code)

    res.status(201).json({
      id: order.id,
      code,
      link,
      qrDataUrl: await qrDataUrl(link),
      expiresAt,
      crew: crew ? { id: crew.id, fullName: crew.fullName, trade: crew.trade } : null,
    })
  }),
)

/** Withdraw a code that has not been used. */
crewRouter.post(
  '/work-orders/:id/cancel',
  requireSectionOfficer,
  validate(idParam, 'params'),
  validate(z.object({ reason: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { reason } = req.body as { reason?: string }
    const actor = req.user!

    const order = await prisma.workOrder.findUnique({ where: { id } })
    if (!order) throw notFound('That work order does not exist')
    if (order.issuedById !== actor.id) {
      throw forbidden('Only the officer who issued this can withdraw it')
    }
    if (order.status === WorkOrderStatus.VERIFIED) {
      throw unprocessable('This job has already been verified')
    }

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.CANCELLED, closedAt: new Date() },
      })
      // Back to the officer's desk: the complaint is live again and needs a
      // new job putting out.
      await tx.complaint.update({ where: { id: order.complaintId }, data: { status: 'ASSIGNED' } })
      await audit.record(tx, {
        action: 'work_order.cancelled',
        entityType: 'complaint',
        entityId: order.complaintId,
        payload: { code: order.code, reason: reason ?? null },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    res.json({ ok: true })
  }),
)

/** The codes out on a complaint, with their QR, for the officer's screen. */
crewRouter.get(
  '/work-orders',
  validate(
    z.object({
      complaintId: z.coerce.number().int().positive().optional(),
      status: z.nativeEnum(WorkOrderStatus).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const { complaintId, status } = req.query as unknown as {
      complaintId?: number
      status?: WorkOrderStatus
    }

    const where: Prisma.WorkOrderWhereInput = {}
    if (complaintId) where.complaintId = complaintId
    if (status) where.status = status
    if (actor.rank === Rank.SECTION_OFFICER) where.issuedById = actor.id

    const orders = await prisma.workOrder.findMany({
      where,
      include: {
        crew: { select: { id: true, fullName: true, trade: true, phone: true } },
        complaint: { select: { id: true, referenceNo: true, title: true } },
        verification: true,
        submissions: { include: { files: true }, orderBy: { submittedAt: 'desc' } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    })

    res.json({
      items: await Promise.all(
        orders.map(async (o) => ({
          id: o.id,
          code: o.code,
          status: o.status,
          instructions: o.instructions,
          issuedAt: o.issuedAt,
          openedAt: o.openedAt,
          submittedAt: o.submittedAt,
          expiresAt: o.expiresAt,
          isExpired: o.expiresAt.getTime() < Date.now(),
          crew: o.crew,
          complaint: o.complaint,
          link: workerLink(env.APP_URL, o.code),
          qrDataUrl: await qrDataUrl(workerLink(env.APP_URL, o.code)),
          verification: o.verification,
          submissions: o.submissions,
        })),
      ),
    })
  }),
)

// ---------------------------------------------------------------------------
// The verification queue
// ---------------------------------------------------------------------------

/**
 * The jobs that genuinely need an officer to look.
 *
 * Deliberately *not* everything awaiting inspection. The pipeline auto-approves
 * strong, uncontested proof and refuses recycled proof outright; the citizen
 * settles most of the rest. What reaches this queue is only what neither could
 * decide — a resident who disputed the work, or weak proof they never answered
 * on. Keeping it that small is the whole design: a queue that fills with
 * routine closures is one an officer stops reading.
 */
crewRouter.get(
  '/verification-queue',
  asyncHandler(async (req, res) => {
    const actor = req.user!

    const where: Prisma.WorkOrderWhereInput = {
      status: WorkOrderStatus.SUBMITTED,
      verification: { outcome: VerificationOutcome.NEEDS_OFFICER },
    }
    // A Section Officer sees their own; anyone above sees their jurisdiction.
    if (actor.rank === Rank.SECTION_OFFICER) {
      where.issuedById = actor.id
    } else if (!isAuthorityWide(actor.rank)) {
      const sectors = await sectorsInScope(prisma, actor.id)
      if (sectors !== null) where.complaint = { sectorId: { in: sectors } }
    }

    const orders = await prisma.workOrder.findMany({
      where,
      include: {
        crew: { select: { id: true, fullName: true, trade: true, phone: true } },
        complaint: {
          include: {
            category: { select: { name: true, icon: true } },
            sector: { select: { id: true, number: true, name: true } },
            citizen: { select: { id: true, fullName: true, phone: true } },
          },
        },
        verification: true,
        submissions: { include: { files: true }, orderBy: { submittedAt: 'desc' }, take: 1 },
      },
      orderBy: [{ submittedAt: 'asc' }],
      take: 100,
    })

    res.json({
      items: orders.map((o) => ({
        id: o.id,
        code: o.code,
        submittedAt: o.submittedAt,
        crew: o.crew,
        complaint: {
          id: o.complaint.id,
          referenceNo: o.complaint.referenceNo,
          title: o.complaint.title,
          description: o.complaint.description,
          photoUrl: o.complaint.photoUrl,
          priority: o.complaint.priority,
          priorityScore: o.complaint.priorityScore,
          category: o.complaint.category,
          sector: o.complaint.sector,
          citizen: o.complaint.citizen,
          /** Whether the resident actively disputed it, or simply never replied. */
          citizenConfirmed: o.complaint.citizenConfirmed,
          citizenProofUrl: o.complaint.citizenProofUrl,
          feedbackComment: o.complaint.feedbackComment,
        },
        verification: o.verification
          ? {
              score: o.verification.score,
              outcome: o.verification.outcome,
              checks: o.verification.checks,
            }
          : null,
        submission: o.submissions[0]
          ? {
              note: o.submissions[0].note,
              submittedAt: o.submissions[0].submittedAt,
              // How much the crew name on this job is worth. The officer
              // ruling on the work is entitled to know whether it came from
              // the phone the slip was opened on or from an unknown one.
              identityAssurance: o.submissions[0].identityAssurance,
              files: o.submissions[0].files
                .filter((f) => !f.isSelfie)
                .map((f) => ({
                  id: f.id,
                  url: f.url,
                  kind: f.kind,
                  capturedAt: f.capturedAt,
                })),
              /** The worker's own photograph, kept apart from the proof. */
              selfieUrl: o.submissions[0].files.find((f) => f.isSelfie)?.url ?? null,
            }
          : null,
      })),
      total: orders.length,
    })
  }),
)

/**
 * The officer's ruling on a job the pipeline could not settle.
 *
 * Ends the work order either way. Accepting resolves the complaint; rejecting
 * puts it back in progress so a fresh code can be issued, and tells the
 * resident their objection was upheld — which is the part that makes disputing
 * worth a citizen's time.
 */
crewRouter.post(
  '/work-orders/:id/rule',
  requireSectionOfficer,
  validate(idParam, 'params'),
  validate(
    z.object({
      accept: z.boolean(),
      note: z.string().max(1000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { accept, note } = req.body as { accept: boolean; note?: string }
    const actor = req.user!

    const order = await prisma.workOrder.findUnique({
      where: { id },
      include: { complaint: true, verification: true },
    })
    if (!order) throw notFound('That work order does not exist')

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: order.complaint.departmentId,
      sectorId: order.complaint.sectorId,
    })
    if (!permitted) throw forbidden('This job is outside your jurisdiction')
    if (order.status !== WorkOrderStatus.SUBMITTED) {
      throw unprocessable('There is nothing waiting on a decision for this job')
    }

    // Rejecting sends the complaint back to the officer's own desk so a fresh
    // code can go out; the crew's claim is what was refused, not the complaint.
    

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: {
          status: accept ? WorkOrderStatus.VERIFIED : WorkOrderStatus.REJECTED,
          closedAt: new Date(),
        },
      })

      if (order.verification) {
        await tx.verification.update({
          where: { id: order.verification.id },
          data: {
            outcome: accept
              ? VerificationOutcome.AUTO_APPROVED
              : VerificationOutcome.REJECTED,
            reviewedById: actor.id,
            reviewedAt: new Date(),
            reviewNote: note ?? null,
          },
        })
      }

      const nextStatus = accept ? ComplaintStatus.RESOLVED : ComplaintStatus.IN_PROGRESS

      await tx.complaint.update({
        where: { id: order.complaintId },
        data: {
          status: nextStatus,
          resolvedAt: accept ? new Date() : null,
        },
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: order.complaintId,
          fromStatus: order.complaint.status,
          toStatus: nextStatus,
          actorId: actor.id,
          note: accept
            ? `Officer accepted the work after review.${note ? ` ${note}` : ''}`
            : `Officer rejected the work.${note ? ` ${note}` : ''} A fresh job must be issued.`,
        },
      })

      await tx.notification.create({
        data: {
          userId: order.complaint.citizenId,
          title: accept
            ? `Closed: ${order.complaint.referenceNo}`
            : `Reopened: ${order.complaint.referenceNo}`,
          body: accept
            ? 'An officer reviewed the work and accepted it.'
            : 'An officer agreed with you — the work was not done, and it has been sent back.',
          link: `/complaints/${order.complaintId}`,
        },
      })

      await audit.record(tx, {
        action: accept ? 'work_order.accepted' : 'work_order.rejected',
        entityType: 'complaint',
        entityId: order.complaintId,
        payload: { code: order.code, note: note ?? null },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    res.json({ ok: true, accepted: accept })
  }),
)
