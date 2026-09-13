import { Router } from 'express'
import { Prisma, RequestStatus, Role } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { reassignAwayFrom } from '../services/assignment.js'
import * as audit from '../services/audit.js'
import { asyncHandler, badRequest, notFound } from '../utils/http.js'

/**
 * The people who run the system: who holds which post, and whether they can
 * still sign in. The administrator's — Layer 3's console, so it may speak of
 * every role below it.
 *
 * Staff only. Residents are not managed from here: an administrator has no
 * business browsing the people who filed complaints.
 *
 * Every change goes on the audit chain, and any change that would leave open
 * requests answered for by someone who can no longer act on them hands that work
 * on in the same transaction (see `reassignAwayFrom`).
 */
export const adminPeopleRouter: Router = Router()
adminPeopleRouter.use(authenticate, requireRole(Role.ADMIN))

const STAFF: Role[] = [Role.AGENT, Role.OFFICER, Role.SUPERVISOR, Role.COMMISSIONER, Role.ADMIN]
/** Roles that hold a posting. Agents work for an agency and are not posted anywhere. */
const POSTED: Role[] = [Role.OFFICER, Role.SUPERVISOR, Role.COMMISSIONER]

const listSchema = z.object({
  agencyId: z.coerce.number().int().positive().optional(),
  orgUnitId: z.coerce.number().int().positive().optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.enum(['active', 'inactive', 'all']).default('all'),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

adminPeopleRouter.get(
  '/people',
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data
    if (q.role && !STAFF.includes(q.role)) throw badRequest('Residents are not managed here')

    const where: Prisma.UserWhereInput = {
      role: q.role ?? { in: STAFF },
      ...(q.agencyId ? { agencyId: q.agencyId } : {}),
      ...(q.orgUnitId ? { postings: { some: { orgUnitId: q.orgUnitId, endedAt: null } } } : {}),
      ...(q.active === 'all' ? {} : { isActive: q.active === 'active' }),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [rows, total, agencies, units] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ agencyId: { sort: 'asc', nulls: 'last' } }, { role: 'asc' }, { name: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isSynthetic: true,
          isActive: true,
          agency: { select: { id: true, code: true, name: true } },
          postings: {
            where: { endedAt: null },
            select: {
              id: true,
              startedAt: true,
              orgUnit: { select: { id: true, code: true, name: true } },
            },
            orderBy: { startedAt: 'desc' },
          },
          _count: {
            select: { assignedRequests: { where: { status: { not: RequestStatus.CLOSED } } } },
          },
        },
      }),
      prisma.user.count({ where }),
      prisma.agency.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      prisma.orgUnit.findMany({
        where: { isActive: true, depth: { lte: 1 } },
        select: { id: true, code: true, name: true, depth: true },
        orderBy: [{ depth: 'asc' }, { code: 'asc' }],
      }),
    ])

    res.json({
      rows: rows.map(({ _count, ...user }) => ({
        ...user,
        openAssigned: _count.assignedRequests,
        posted: POSTED.includes(user.role),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      agencies,
      units,
    })
  }),
)

/**
 * One person: every post they have held, and what the chain records about them —
 * both what was done to their account and what they did.
 */
adminPeopleRouter.get(
  '/people/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('Invalid person id')
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isSynthetic: true,
        isActive: true,
        agency: { select: { id: true, code: true, name: true } },
        postings: {
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
            agency: { select: { id: true, code: true, name: true } },
            orgUnit: { select: { id: true, code: true, name: true } },
          },
          orderBy: { startedAt: 'desc' },
        },
        _count: {
          select: { assignedRequests: { where: { status: { not: RequestStatus.CLOSED } } } },
        },
      },
    })
    if (!user || !STAFF.includes(user.role)) throw notFound('No staff member with that id')

    const [history, agencies, units] = await Promise.all([
      prisma.auditEvent.findMany({
        where: { OR: [{ entityType: 'user', entityId: String(id) }, { actorId: id }] },
        orderBy: { id: 'desc' },
        take: 25,
        select: { id: true, action: true, entityType: true, entityId: true, actorLabel: true, payload: true, createdAt: true },
      }),
      prisma.agency.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      prisma.orgUnit.findMany({
        where: { isActive: true, depth: { lte: 1 } },
        select: { id: true, code: true, name: true, depth: true },
        orderBy: [{ depth: 'asc' }, { code: 'asc' }],
      }),
    ])

    const { _count, ...person } = user
    res.json({
      person: { ...person, openAssigned: _count.assignedRequests, posted: POSTED.includes(user.role) },
      history,
      agencies,
      units,
      isSelf: req.user!.id === id,
    })
  }),
)

async function staffMember(id: number) {
  if (!Number.isInteger(id)) throw badRequest('Invalid person id')
  const user = await prisma.user.findUnique({
    where: { id },
    include: { postings: { where: { endedAt: null }, include: { orgUnit: true, agency: true } } },
  })
  if (!user || !STAFF.includes(user.role)) throw notFound('No staff member with that id')
  return user
}

const reason = z.string().trim().min(5, 'Say why — this goes on the audit chain').max(500)

const postingSchema = z.object({
  agencyId: z.number().int().positive(),
  orgUnitId: z.number().int().positive(),
  reason,
})

/**
 * Move someone to a new post: end what they hold, start the new one, and hand
 * on any open requests they can no longer answer for.
 */
adminPeopleRouter.post(
  '/people/:id/posting',
  validate(postingSchema),
  asyncHandler(async (req, res) => {
    const user = await staffMember(Number(req.params.id))
    const body = req.body as z.infer<typeof postingSchema>
    const admin = req.user!

    if (!POSTED.includes(user.role)) {
      throw badRequest('Only officers, supervisors and commissioners hold a posting')
    }
    const [agency, unit] = await Promise.all([
      prisma.agency.findUnique({ where: { id: body.agencyId } }),
      prisma.orgUnit.findUnique({ where: { id: body.orgUnitId } }),
    ])
    if (!agency) throw badRequest('No such agency')
    if (!unit || !unit.isActive || unit.depth > 1) {
      throw badRequest('Post someone to the borough or to one of its boards')
    }
    const current = user.postings
    if (current.length === 1 && current[0]!.agencyId === agency.id && current[0]!.orgUnitId === unit.id) {
      throw badRequest('They already hold that post')
    }

    const at = new Date()
    const handedOn = await prisma.$transaction(async (tx) => {
      await tx.posting.updateMany({ where: { userId: user.id, endedAt: null }, data: { endedAt: at } })
      await tx.posting.create({
        data: { userId: user.id, agencyId: agency.id, orgUnitId: unit.id, startedAt: at },
      })
      if (user.agencyId !== agency.id) {
        await tx.user.update({ where: { id: user.id }, data: { agencyId: agency.id } })
      }
      const tally =
        user.role === Role.OFFICER
          ? await reassignAwayFrom(tx, user.id, { userId: admin.id, label: admin.name })
          : null
      await audit.record(tx, {
        action: 'user.posting_moved',
        entityType: 'user',
        entityId: user.id,
        payload: {
          name: user.name,
          role: user.role,
          from: current.map((p) => ({ agency: p.agency.code, unit: p.orgUnit.code })),
          to: { agency: agency.code, unit: unit.code },
          reason: body.reason,
          ...(tally ? { requests: tally } : {}),
        },
        actorId: admin.id,
        actorLabel: admin.name,
      })
      return tally
    })

    res.json({ ok: true, requests: handedOn })
  }),
)

const activeSchema = z.object({ active: z.boolean(), reason })

/**
 * Deactivate or reactivate an account. Deactivation takes effect on the
 * person's next request — every authenticated route re-reads the account — and
 * an officer's open requests are handed on at once.
 *
 * Reactivation gives back the account and its posting, not the requests: those
 * now have an officer who has been answering for them.
 */
adminPeopleRouter.post(
  '/people/:id/active',
  validate(activeSchema),
  asyncHandler(async (req, res) => {
    const user = await staffMember(Number(req.params.id))
    const body = req.body as z.infer<typeof activeSchema>
    const admin = req.user!

    if (user.id === admin.id) throw badRequest('You cannot change your own account’s access from here')
    if (user.isActive === body.active) {
      throw badRequest(body.active ? 'That account is already active' : 'That account is already deactivated')
    }

    const handedOn = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { isActive: body.active } })
      const tally =
        !body.active && user.role === Role.OFFICER
          ? await reassignAwayFrom(tx, user.id, { userId: admin.id, label: admin.name })
          : null
      await audit.record(tx, {
        action: body.active ? 'user.reactivated' : 'user.deactivated',
        entityType: 'user',
        entityId: user.id,
        payload: {
          name: user.name,
          role: user.role,
          reason: body.reason,
          ...(tally ? { requests: tally } : {}),
        },
        actorId: admin.id,
        actorLabel: admin.name,
      })
      return tally
    })

    res.json({ ok: true, requests: handedOn })
  }),
)
