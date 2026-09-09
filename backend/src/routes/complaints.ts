/**
 * Complaint filing and tracking.
 *
 * Filing is where GCCE runs: the citizen supplies what they saw, and everything
 * else — category, sector, department, the accountable officer, priority and
 * deadline — is decided by the engine and recorded with its reasoning.
 */
import { Router } from 'express'
import {
  ComplaintStatus,
  DecisionKind,
  DecisionOutcome,
  DepartmentStatus,
  Prisma,
  Rank,
  WorkOrderStatus,
} from '@prisma/client'
import { z } from 'zod'
import { createLogger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireCircleOfficer } from '../middleware/auth.js'
import { uploadPhoto, photoUrl } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import * as decisions from '../services/decisions.js'
import { applySupportPriority, nextThreshold } from '../services/community.js'
import { clusterComplaint } from '../services/clustering.js'
import { applyPriority } from '../services/priority.js'
import { applyCitizenVerdict, type Check } from '../services/verification.js'
import { OPEN_STATUSES, canTransition, routeComplaint } from '../services/gcce.js'
import {
  hasJurisdiction,
  isAuthorityWide,
  isOfficer,
  sectorsInScope,
  departmentsInScope,
} from '../services/hierarchy.js'
import { scheduleUnitRescore } from '../services/riskSignals.js'
import {
  asyncHandler,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from '../utils/http.js'
import { formBoolean } from '../utils/schema.js'
import { COMPLAINT_INCLUDE, publicComplaint, referenceNoFor } from '../utils/serialize.js'
import { describeSla, estimateSla } from '../services/sla.js'

const log = createLogger('complaints')

export const complaintsRouter: Router = Router()

complaintsRouter.use(authenticate)

/**
 * Statuses in which a citizen may still correct where their complaint went.
 *
 * ASSIGNED is included because routing sets it the moment it finds an officer —
 * it is the normal state of a complaint the citizen is looking at when the
 * confirmation appears. The line is drawn at IN_PROGRESS: once someone has been
 * sent to site, moving the complaint to another department strands work already
 * under way, so from there it is the officer's call.
 */
const CORRECTABLE_STATUSES: ComplaintStatus[] = [
  ComplaintStatus.SUBMITTED,
  ComplaintStatus.ROUTED,
  ComplaintStatus.ASSIGNED,
]

const createSchema = z.object({
  title: z.string().min(5, 'Give your complaint a short title').max(200),
  description: z.string().min(10, 'Describe the issue in a little more detail').max(4000),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
  landmark: z.string().max(200).optional(),
  /// Declares the issue as the neighbourhood's rather than one household's,
  /// which is what lets neighbours add their weight to it.
  isCommunity: formBoolean.default(false),
})

const listSchema = z.object({
  status: z.nativeEnum(ComplaintStatus).optional(),
  sectorId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  scope: z.enum(['mine', 'jurisdiction', 'all']).default('jurisdiction'),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
})

/**
 * Build the visibility filter for the caller.
 *
 * Scoping happens here rather than in the UI: a Junior Engineer must not be
 * able to read another circle's complaints by editing a query string, and a
 * citizen must only ever see their own.
 */
async function visibilityFilter(
  user: NonNullable<Express.Request['user']>,
  scope: 'mine' | 'jurisdiction' | 'all',
): Promise<Prisma.ComplaintWhereInput> {
  if (user.rank === Rank.CITIZEN) return { citizenId: user.id }

  if (user.rank === Rank.FIELD_WORKER) return { assignedWorkerId: user.id }

  if (scope === 'mine') return { assignedOfficerId: user.id }

  if (isAuthorityWide(user.rank)) return {}

  const [sectors, departments] = await Promise.all([
    sectorsInScope(prisma, user.id),
    departmentsInScope(prisma, user.id),
  ])

  const where: Prisma.ComplaintWhereInput = {}
  if (sectors !== null) where.sectorId = { in: sectors }
  if (departments !== null) where.departmentId = { in: departments }
  return where
}

/**
 * File a complaint.
 *
 * The row is created first so its id can seed the reference number, then GCCE
 * routes it. Both happen in one transaction — a complaint that exists but was
 * never routed would sit invisible to every inbox.
 *
 * A citizen supplies no category. They are not required to know the difference
 * between Public Health and Jal Vibhag, and asking them to guess is how
 * complaints end up in the wrong queue — it also fills the routing history with
 * their guesses rather than with what the classifier actually decided, which is
 * the one signal that would let the classifier improve. Classification is the
 * engine's job; the citizen's part is to confirm or correct it afterwards, via
 * `POST /:id/category` below.
 */
complaintsRouter.post(
  '/',
  uploadPhoto,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>
    const actor = req.user!

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.complaint.create({
        data: {
          referenceNo: 'PENDING',
          citizenId: actor.id,
          title: body.title,
          description: body.description,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          address: body.address ?? null,
          landmark: body.landmark ?? null,
          isCommunity: body.isCommunity,
          photoUrl: req.file ? photoUrl(req.file.filename) : null,
        },
      })

      const complaint = await tx.complaint.update({
        where: { id: created.id },
        data: { referenceNo: referenceNoFor(created.id, created.createdAt) },
      })

      await audit.record(tx, {
        action: 'complaint.filed',
        entityType: 'complaint',
        entityId: complaint.id,
        payload: { referenceNo: complaint.referenceNo, title: complaint.title },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      const decision = await routeComplaint(tx, complaint, actor)

      const full = await tx.complaint.findUniqueOrThrow({
        where: { id: complaint.id },
        include: COMPLAINT_INCLUDE,
      })
      return { complaint: full, decision }
    })

    // Fired after the transaction commits so neither can roll it back.
    if (result.decision.orgUnitId != null) scheduleUnitRescore(result.decision.orgUnitId)

    /*
     * Grouping runs before scoring, and both run after the commit.
     *
     * Order matters: how many other people have reported the same thing is one
     * of the inputs to urgency, so a complaint has to know its group before it
     * can know its priority. Neither may take the filing transaction down with
     * it — a citizen's report being *recorded* must never depend on the
     * clustering heuristic behaving.
     */
    let grouping: Awaited<ReturnType<typeof clusterComplaint>> = null
    let urgency: Awaited<ReturnType<typeof applyPriority>> | null = null
    try {
      grouping = await clusterComplaint(prisma, result.complaint.id)
      urgency = await applyPriority(prisma, result.complaint.id)

      // Everyone already in the group is now backed by one more household, so
      // their urgency has changed too.
      if (grouping) {
        const siblings = await prisma.complaint.findMany({
          where: { clusterId: grouping.clusterId, id: { not: result.complaint.id } },
          select: { id: true },
        })
        for (const sibling of siblings) await applyPriority(prisma, sibling.id)
      }
    } catch (err) {
      log.error('post-filing scoring failed', err)
    }

    const saved = await prisma.complaint.findUniqueOrThrow({
      where: { id: result.complaint.id },
      include: COMPLAINT_INCLUDE,
    })

    res.status(201).json({
      complaint: publicComplaint(saved),
      routing: result.decision,
      /** Why it was judged this urgent, shown to the citizen on filing. */
      priority: urgency
        ? { score: urgency.score, priority: urgency.priority, factors: urgency.factors }
        : null,
      /** Set when others nearby have already reported the same thing. */
      cluster: grouping,
    })
  }),
)

complaintsRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { status, sectorId, departmentId, scope, q, page, size } =
      req.query as unknown as z.infer<typeof listSchema>
    const actor = req.user!

    const where = await visibilityFilter(actor, scope)
    if (status) where.status = status
    if (sectorId) where.sectorId = sectorId
    if (departmentId) where.departmentId = departmentId
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { referenceNo: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        include: COMPLAINT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.complaint.count({ where }),
    ])

    res.json({ items: items.map(publicComplaint), total, page, size })
  }),
)

/** Counts for the caller's own scope — drives the dashboard tiles. */
complaintsRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const where = await visibilityFilter(actor, 'jurisdiction')

    const grouped = await prisma.complaint.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })

    const byStatus = Object.fromEntries(
      Object.values(ComplaintStatus).map((s) => [s, 0]),
    ) as Record<ComplaintStatus, number>
    for (const row of grouped) byStatus[row.status] = row._count._all

    const [overdue, escalated] = await Promise.all([
      prisma.complaint.count({
        where: { ...where, slaDueAt: { lt: new Date() }, status: { in: OPEN_STATUSES } },
      }),
      prisma.complaint.count({ where: { ...where, escalationLevel: { gt: 0 } } }),
    ])

    const open = OPEN_STATUSES.reduce((sum, s) => sum + byStatus[s], 0)

    res.json({
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      open,
      resolved: byStatus.RESOLVED + byStatus.CLOSED,
      overdue,
      escalated,
    })
  }),
)

/** Map pins for the caller's jurisdiction. */
/**
 * How many pins one map request will return.
 *
 * Leaflet is drawing a DOM marker per complaint with no clustering, so this is
 * as much a rendering budget as a query one. Raising it without adding
 * clustering first would trade a truthful map for an unusable one.
 */
const MAP_PIN_LIMIT = 1000

complaintsRouter.get(
  '/map',
  validate(
    z.object({
      status: z.enum(['open', 'all']).default('open'),
      departmentId: z.coerce.number().int().positive().optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { status, departmentId } = req.query as unknown as {
      status: 'open' | 'all'
      departmentId?: number
    }
    const actor = req.user!

    const where = await visibilityFilter(actor, 'jurisdiction')
    if (status === 'open') where.status = { in: OPEN_STATUSES }
    if (departmentId) where.departmentId = departmentId
    where.latitude = { not: null }
    where.longitude = { not: null }

    const items = await prisma.complaint.findMany({
      where,
      select: {
        id: true,
        referenceNo: true,
        title: true,
        latitude: true,
        longitude: true,
        status: true,
        priority: true,
        slaDueAt: true,
        escalationLevel: true,
        category: { select: { name: true, icon: true } },
        sector: { select: { id: true, number: true, name: true } },
        department: { select: { id: true, name: true, icon: true } },
      },
      take: MAP_PIN_LIMIT,
      orderBy: { createdAt: 'desc' },
    })

    /*
     * `total` is counted, not measured from the page.
     *
     * It used to be `items.length`, which meant the cap reported itself as the
     * answer: with 1,390 open complaints the map returned 1,000 and told the
     * caller that 1,000 was all there was. On a screen whose whole job is
     * oversight, silently showing five sixths of the city is worse than showing
     * none of it, because nothing looks wrong.
     */
    const total = await prisma.complaint.count({ where })

    res.json({ items, total, truncated: total > items.length, limit: MAP_PIN_LIMIT })
  }),
)

async function loadVisibleComplaint(id: number, actor: NonNullable<Express.Request['user']>) {
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      ...COMPLAINT_INCLUDE,
      history: {
        include: { actor: { select: { id: true, fullName: true, rank: true } } },
        orderBy: { createdAt: 'asc' },
      },
      escalations: {
        include: {
          toUser: { select: { id: true, fullName: true } },
          fromUnit: { select: { id: true, name: true, kindLabel: true } },
          toUnit: { select: { id: true, name: true, kindLabel: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      cluster: true,
    },
  })
  if (!complaint) throw notFound('That complaint does not exist')

  const isOwner = complaint.citizenId === actor.id
  const isAssigned =
    complaint.assignedOfficerId === actor.id || complaint.assignedWorkerId === actor.id

  // A community grievance is, by its nature, the neighbourhood's business: a
  // resident of the sector it concerns may read it and add their support. A
  // private complaint stays private to the person who filed it.
  const isNeighbour =
    complaint.isCommunity &&
    complaint.sectorId != null &&
    complaint.sectorId === actor.homeSectorId

  if (!isOwner && !isAssigned && !isNeighbour) {
    if (!isOfficer(actor.rank)) throw forbidden('You do not have access to this complaint')
    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')
  }

  return complaint
}

complaintsRouter.get(
  '/:id',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const complaint = await loadVisibleComplaint(Number(req.params.id), actor)

    // The latest field submission, so the person who reported the problem can
    // see what the crew actually sent rather than being asked to trust a status.
    const latestOrder = await prisma.workOrder.findFirst({
      where: { complaintId: complaint.id, status: WorkOrderStatus.SUBMITTED },
      include: {
        submissions: { include: { files: true }, orderBy: { submittedAt: 'desc' }, take: 1 },
        verification: true,
      },
      orderBy: { submittedAt: 'desc' },
    })
    const latestSubmission = latestOrder?.submissions[0] ?? null

    const supports = await prisma.complaintSupport.findMany({
      where: { complaintId: complaint.id },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    })

    /*
     * How long this usually takes here, alongside the deadline.
     *
     * Recomputed rather than stored: it is a lookup, and a stored copy would
     * quietly go stale as the unit's actual performance changed — leaving the
     * citizen reading last quarter's answer. The wording tracks how specific
     * the evidence is, so the product never claims to know a sector when it
     * only knows a category.
     */
    const estimate =
      complaint.categoryId != null
        ? estimateSla(
            {
              categoryId: complaint.categoryId,
              orgUnitId: complaint.orgUnitId,
              priority: complaint.priority,
            },
            complaint.category?.defaultSlaHours ?? 72,
          )
        : null

    res.json({
      ...publicComplaint(complaint),
      slaEstimate: estimate ? { ...estimate, sentence: describeSla(estimate) } : null,
      /** Set only while a submission is genuinely waiting on this citizen. */
      awaitingMyConfirmation:
        complaint.citizenId === actor.id &&
        complaint.status === ComplaintStatus.AWAITING_VERIFICATION &&
        latestSubmission != null,
      workProof: latestSubmission
        ? {
            note: latestSubmission.note,
            submittedAt: latestSubmission.submittedAt,
            files: latestSubmission.files.map((f) => ({ id: f.id, url: f.url, kind: f.kind })),
            score: latestOrder?.verification?.score ?? null,
          }
        : null,
      citizenConfirmed: complaint.citizenConfirmed,
      citizenProofUrl: complaint.citizenProofUrl,
      priorityScore: complaint.priorityScore,
      priorityFactors: complaint.priorityFactors,
      cluster: complaint.cluster
        ? {
            id: complaint.cluster.id,
            label: complaint.cluster.label,
            size: complaint.cluster.size,
            isDismissed: complaint.cluster.isDismissed,
          }
        : null,
      isCommunity: complaint.isCommunity,
      supporters: supports.length,
      viewerHasSupported: supports.some((s) => s.userId === actor.id),
      viewerCanSupport:
        complaint.isCommunity &&
        complaint.citizenId !== actor.id &&
        complaint.sectorId != null &&
        complaint.sectorId === actor.homeSectorId &&
        OPEN_STATUSES.includes(complaint.status),
      nextThreshold: await nextThreshold(prisma, complaint.id),
      supportList: supports.map((s) => ({
        id: s.id,
        fullName: s.user.fullName,
        note: s.note,
        createdAt: s.createdAt,
      })),
      history: complaint.history.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        evidenceUrl: h.evidenceUrl,
        createdAt: h.createdAt,
        actor: h.actor ? { id: h.actor.id, fullName: h.actor.fullName, rank: h.actor.rank } : null,
      })),
      escalations: complaint.escalations.map((e) => ({
        id: e.id,
        // Escalation is a step between units now. The labels are pre-built so
        // the citizen view never has to know about ranks or tree depth.
        fromLabel: e.fromUnit ? `${e.fromUnit.kindLabel} ${e.fromUnit.name}` : null,
        toLabel: e.toUnit ? `${e.toUnit.kindLabel} ${e.toUnit.name}` : null,
        reason: e.reason,
        hoursOverdue: e.hoursOverdue,
        createdAt: e.createdAt,
        toUser: e.toUser,
      })),
    })
  }),
)

/** Citizen feedback, accepted only once the work is actually done. */
complaintsRouter.post(
  '/:id/feedback',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(1000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { rating, comment } = req.body as { rating: number; comment?: string }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')
    if (complaint.citizenId !== actor.id) {
      throw forbidden('Only the person who filed a complaint can rate it')
    }
    if (complaint.status !== ComplaintStatus.RESOLVED && complaint.status !== ComplaintStatus.CLOSED) {
      throw badRequest('You can leave feedback once the complaint has been resolved')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { feedbackRating: rating, feedbackComment: comment ?? null },
        include: COMPLAINT_INCLUDE,
      })
      await audit.record(tx, {
        action: 'complaint.feedback',
        entityType: 'complaint',
        entityId: id,
        payload: { rating, hasComment: Boolean(comment) },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(publicComplaint(updated))
  }),
)

/**
 * Sign-off. Restricted to Circle Officer and above — a Junior Engineer must not
 * close their own section's work, which is the separation the manual process
 * relies on.
 */
complaintsRouter.post(
  '/:id/close',
  requireCircleOfficer,
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(z.object({ note: z.string().max(1000).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!
    const { note } = req.body as { note?: string }

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')

    const permitted = await hasJurisdiction(prisma, actor, {
      departmentId: complaint.departmentId,
      sectorId: complaint.sectorId,
    })
    if (!permitted) throw forbidden('This complaint is outside your jurisdiction')

    if (!canTransition(complaint.status, ComplaintStatus.CLOSED)) {
      throw badRequest(
        `A complaint that is ${complaint.status.toLowerCase().replace(/_/g, ' ')} cannot be closed — it must be resolved first`,
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.complaint.update({
        where: { id },
        data: { status: ComplaintStatus.CLOSED, closedAt: new Date() },
        include: COMPLAINT_INCLUDE,
      })
      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: complaint.status,
          toStatus: ComplaintStatus.CLOSED,
          actorId: actor.id,
          note: note ?? `Closed by ${actor.designationTitle ?? 'supervising officer'}.`,
        },
      })
      await tx.notification.create({
        data: {
          userId: complaint.citizenId,
          title: 'Complaint closed',
          body: `Your complaint ${complaint.referenceNo} has been closed. We would appreciate your feedback.`,
          link: `/complaints/${id}`,
        },
      })
      await audit.record(tx, {
        action: 'complaint.closed',
        entityType: 'complaint',
        entityId: id,
        payload: { note: note ?? null },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    if (updated.orgUnitId != null) scheduleUnitRescore(updated.orgUnitId)

    res.json(publicComplaint(updated))
  }),
)

// ---------------------------------------------------------------------------
// Community support
// ---------------------------------------------------------------------------

/**
 * Back a neighbour's community grievance.
 *
 * Restricted to residents of the sector the grievance concerns. Not a fussy
 * rule: support raises priority, and a form of weight that anyone anywhere can
 * add is a form of weight that can be manufactured. Tying it to where a person
 * lives keeps it meaning what it says.
 */
complaintsRouter.post(
  '/:id/support',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(z.object({ note: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { note } = req.body as { note?: string }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That grievance does not exist')

    if (!complaint.isCommunity) {
      throw unprocessable(
        'This was filed as a private complaint, so it cannot be backed by neighbours.',
      )
    }
    if (complaint.citizenId === actor.id) {
      throw unprocessable('You filed this one — it already carries your name.')
    }
    if (!OPEN_STATUSES.includes(complaint.status)) {
      throw unprocessable('This grievance is already closed.')
    }
    if (complaint.sectorId == null || complaint.sectorId !== actor.homeSectorId) {
      throw forbidden(
        'You can back grievances in the sector you live in. Set your sector on your profile if it is wrong.',
      )
    }
    if (await prisma.complaintSupport.findUnique({
      where: { complaintId_userId: { complaintId: id, userId: actor.id } },
    })) {
      throw conflict('You have already backed this grievance.')
    }

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.complaintSupport.create({
        data: { complaintId: id, userId: actor.id, note: note || null },
      })

      await audit.record(tx, {
        action: 'complaint.supported',
        entityType: 'complaint',
        entityId: id,
        payload: { referenceNo: complaint.referenceNo },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      const result = await applySupportPriority(tx, id, actor)

      // The person who filed it should see their neighbourhood turning up.
      await tx.notification.create({
        data: {
          userId: complaint.citizenId,
          title: `A neighbour backed ${complaint.referenceNo}`,
          body:
            result.raisedTo != null
              ? `${result.supporters} residents have now backed this, and it has been raised to ${result.raisedTo.toLowerCase()} priority.`
              : `${result.supporters} residents have now backed this grievance.`,
          link: `/complaints/${id}`,
        },
      })

      return result
    })

    res.status(201).json(outcome)
  }),
)

/** Withdraw support. The priority already earned is not walked back. */
complaintsRouter.delete(
  '/:id/support',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!

    const existing = await prisma.complaintSupport.findUnique({
      where: { complaintId_userId: { complaintId: id, userId: actor.id } },
    })
    if (!existing) throw notFound('You have not backed this grievance.')

    await prisma.$transaction(async (tx) => {
      await tx.complaintSupport.delete({ where: { id: existing.id } })
      await audit.record(tx, {
        action: 'complaint.support_withdrawn',
        entityType: 'complaint',
        entityId: id,
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
    })

    const supporters = await prisma.complaintSupport.count({ where: { complaintId: id } })
    res.json({ supporters, raisedTo: null })
  }),
)

// ---------------------------------------------------------------------------
// The citizen's verdict
// ---------------------------------------------------------------------------

/**
 * The citizen says whether the work was actually done.
 *
 * This is the hinge of the whole verification design. Automated checks can
 * prove a photograph is stale, recycled or from the wrong place; only somebody
 * standing on the street can say the drain runs. So rather than routing every
 * closure through a Junior Engineer — the bottleneck that makes these systems
 * silt up — the system asks the one person who already cares.
 *
 * A confirmation closes the complaint outright. A denial reopens it and puts it
 * in front of the officer, with the citizen's own photograph attached.
 */
complaintsRouter.post(
  '/:id/confirm',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  uploadPhoto,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const actor = req.user!

    const body = z
      .object({
        confirmed: formBoolean,
        rating: z.coerce.number().int().min(1).max(5).optional(),
        comment: z.string().max(1000).optional(),
      })
      .parse(req.body)

    const complaint = await prisma.complaint.findUnique({
      where: { id },
      include: {
        workOrders: {
          where: { status: WorkOrderStatus.SUBMITTED },
          include: { verification: true },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    })
    if (!complaint) throw notFound('That complaint does not exist')
    if (complaint.citizenId !== actor.id) {
      throw forbidden('Only the person who reported this can confirm it')
    }
    if (complaint.status !== ComplaintStatus.AWAITING_VERIFICATION) {
      throw unprocessable('There is no completed work waiting on your confirmation.')
    }

    const order = complaint.workOrders[0] ?? null
    const proofUrl = req.file ? photoUrl(req.file.filename) : null

    const saved = await prisma.$transaction(async (tx) => {
      // Fold the verdict into the assessment so the score, and the reason for
      // it, stay readable to everyone afterwards.
      if (order?.verification) {
        const current = {
          score: order.verification.score,
          checks: order.verification.checks as unknown as Check[],
          outcome: order.verification.outcome,
        }
        const updated = applyCitizenVerdict(current, body.confirmed)
        await tx.verification.update({
          where: { id: order.verification.id },
          data: {
            score: updated.score,
            checks: updated.checks as unknown as Prisma.InputJsonValue,
            outcome: updated.outcome,
          },
        })
      }

      if (order) {
        /*
         * A confirmation ends the job. A dispute does not.
         *
         * REJECTED means finally rejected, and only an officer can decide that
         * — the resident has raised an objection, not delivered a verdict on
         * the crew. So a disputed order stays SUBMITTED, carrying the
         * NEEDS_OFFICER outcome that puts it on the officer's queue. Closing it
         * here would have taken it off that queue and left the objection with
         * nobody to answer it.
         */
        if (body.confirmed) {
          await tx.workOrder.update({
            where: { id: order.id },
            data: { status: WorkOrderStatus.VERIFIED, closedAt: new Date() },
          })
        }
      }

      const nextStatus = body.confirmed ? ComplaintStatus.RESOLVED : ComplaintStatus.IN_PROGRESS

      const updated = await tx.complaint.update({
        where: { id },
        data: {
          status: nextStatus,
          citizenConfirmed: body.confirmed,
          citizenConfirmedAt: new Date(),
          citizenProofUrl: proofUrl,
          resolvedAt: body.confirmed ? new Date() : null,
          ...(body.rating ? { feedbackRating: body.rating } : {}),
          ...(body.comment ? { feedbackComment: body.comment } : {}),
        },
        include: COMPLAINT_INCLUDE,
      })

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: id,
          fromStatus: ComplaintStatus.AWAITING_VERIFICATION,
          toStatus: nextStatus,
          actorId: actor.id,
          note: body.confirmed
            ? `Resident confirmed the work was done.${body.comment ? ` "${body.comment}"` : ''}`
            : `Resident says the work was not done.${body.comment ? ` "${body.comment}"` : ''}`,
          evidenceUrl: proofUrl,
        },
      })

      // The officer hears about it either way, but only has to act on a denial.
      if (complaint.assignedOfficerId) {
        await tx.notification.create({
          data: {
            userId: complaint.assignedOfficerId,
            title: body.confirmed
              ? `Closed by the resident: ${complaint.referenceNo}`
              : `Disputed by the resident: ${complaint.referenceNo}`,
            body: body.confirmed
              ? 'The resident confirms the work was done. No action needed from you.'
              : 'The resident says the work was not done. This is back on your desk.',
            link: '/officer/desk',
          },
        })
      }

      await audit.record(tx, {
        action: body.confirmed ? 'complaint.citizen_confirmed' : 'complaint.citizen_disputed',
        entityType: 'complaint',
        entityId: id,
        payload: {
          workOrderCode: order?.code ?? null,
          rating: body.rating ?? null,
          hasProof: proofUrl != null,
        },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })

      return updated
    })

    if (saved.orgUnitId != null) scheduleUnitRescore(saved.orgUnitId)

    res.json({
      complaint: publicComplaint(saved),
      message: body.confirmed
        ? 'Thank you — this is now closed. Your confirmation is what closed it.'
        : 'Thank you. This has gone back to the officer responsible, with your photo attached.',
    })
  }),
)


/**
 * The citizen's answer to "we sent this to Electrical — is that right?"
 *
 * The confirmation shown after filing, and the correction behind it. This is
 * deliberately the *only* way a citizen touches the category: after the engine
 * has committed to an answer, never before it. That ordering is what keeps the
 * routing history usable as training data — every row records what the
 * classifier decided, and a correction here records that it was wrong, which is
 * the labelled disagreement worth learning from.
 *
 * Open to the person who filed it, and only while nobody has started work: once
 * a crew is on site, moving the complaint to another department is an officer's
 * decision, not a citizen's.
 */
complaintsRouter.post(
  '/:id/category',
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  validate(
    z.object({
      /// Null means "the engine got it wrong and I do not know what it is" —
      /// which sends it to manual categorisation rather than to a wrong desk.
      categoryId: z.number().int().positive().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const { categoryId } = req.body as { categoryId: number | null }
    const actor = req.user!

    const complaint = await prisma.complaint.findUnique({ where: { id } })
    if (!complaint) throw notFound('That complaint does not exist')
    if (complaint.citizenId !== actor.id) {
      throw forbidden('Only the person who reported this can correct where it went.')
    }
    if (!CORRECTABLE_STATUSES.includes(complaint.status)) {
      throw unprocessable(
        'Work has already started on this one. Ask the officer handling it to move it.',
      )
    }
    /*
     * Answering "yes, that is right" is an answer, not an error.
     *
     * This used to throw 422 — "that is already where this complaint sits" —
     * which meant the confirmation step shown after filing had exactly one
     * outcome the system could record: disagreement. Every label the classifier
     * ever received was one of its own mistakes. A model trained on that learns
     * where it goes wrong and nothing whatever about where it goes right, and
     * the agreement rate on /admin/decisions read 0% for the truest of reasons:
     * agreement was unrepresentable.
     *
     * So the same category coming back is now recorded as an endorsement and
     * the complaint is returned untouched. Nothing is re-routed, because
     * nothing changed — the only product of this call is the label.
     */
    if (complaint.categoryId === categoryId) {
      await prisma.$transaction(async (tx) => {
        await decisions.resolve(tx, {
          complaintId: id,
          kind: DecisionKind.CATEGORY,
          outcome: DecisionOutcome.CONFIRMED,
          overriddenById: actor.id,
        })

        await audit.record(tx, {
          action: 'complaint.category_confirmed',
          entityType: 'complaint',
          entityId: id,
          payload: { categoryId },
          actorId: actor.id,
          actorLabel: actor.fullName,
          source: 'api',
        })
      })

      const unchanged = await prisma.complaint.findUniqueOrThrow({
        where: { id },
        include: COMPLAINT_INCLUDE,
      })
      return res.json({ complaint: publicComplaint(unchanged), routing: null, confirmed: true })
    }

    if (categoryId != null) {
      const category = await prisma.complaintCategory.findUnique({
        where: { id: categoryId },
        include: { department: true },
      })
      if (!category || !category.isActive) throw unprocessable('That category does not exist')
      if (category.department.status !== DepartmentStatus.ACTIVE) {
        throw unprocessable(
          `${category.department.name} is not accepting complaints yet. ${category.department.roadmapNote ?? ''}`.trim(),
        )
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.complaint.update({ where: { id }, data: { categoryId } })

      await audit.record(tx, {
        action: 'complaint.recategorised',
        entityType: 'complaint',
        entityId: id,
        payload: {
          // Both halves are recorded, because the pair is the training signal:
          // what the engine decided, and what the person who saw it says.
          engineChose: complaint.categoryId,
          citizenChose: categoryId,
        },
        actorId: actor.id,
        actorLabel: actor.fullName,
        source: 'api',
      })

      /*
       * Settle the engine's own CATEGORY decision before re-routing.
       *
       * Order matters, and it is the whole reason this sits above the re-route
       * rather than below it: `routeComplaint` writes a *new* CATEGORY decision,
       * so resolving afterwards would mark the fresh one — the one nobody has
       * seen yet — as agreed or overruled by a citizen who was answering the
       * previous one.
       *
       * This is the highest-quality label the system produces. The person who
       * reported the problem is telling the classifier it was wrong, in the one
       * case where they unambiguously know better.
       */
      await decisions.resolve(tx, {
        complaintId: id,
        kind: DecisionKind.CATEGORY,
        outcome:
          categoryId === complaint.categoryId
            ? DecisionOutcome.CONFIRMED
            : DecisionOutcome.OVERRIDDEN,
        overriddenTo: categoryId != null ? String(categoryId) : 'unclassified',
        overriddenById: actor.id,
        overrideReason: 'Citizen corrected the category after filing',
      })

      // Re-route from scratch. The category is only the first of the answers
      // that depend on it — department, unit and officer all move with it.
      const reloaded = await tx.complaint.findUniqueOrThrow({ where: { id } })
      const decision = await routeComplaint(tx, reloaded, actor)

      const full = await tx.complaint.findUniqueOrThrow({
        where: { id },
        include: COMPLAINT_INCLUDE,
      })
      return { complaint: full, decision }
    })

    if (result.decision.orgUnitId != null) scheduleUnitRescore(result.decision.orgUnitId)
    await applyPriority(prisma, id).catch((err) =>
      log.warn(`could not rescore priority for ${id} after recategorisation`, err),
    )

    res.json({
      complaint: publicComplaint(result.complaint),
      routing: result.decision,
    })
  }),
)
