/**
 * The citizen's own view of the authority.
 *
 * Everything here is scoped to where the person lives. A resident of Sector 62
 * gets Sector 62's grievances, Sector 62's works, and the officer who actually
 * answers for Sector 62 — by name. That last one matters more than it looks:
 * the usual failure of a municipal portal is that a citizen can file into it
 * but can never find out who is holding their complaint.
 *
 * Officers are welcome to read these too — a Junior Engineer is also a resident
 * somewhere — so the routes authenticate but do not require the CITIZEN rank.
 * They simply need a home sector to answer from.
 */
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { nextThreshold } from '../services/community.js'
import { OPEN_STATUSES } from '../services/gcce.js'
import { RANK_LABEL, RANK_LEVEL } from '../services/hierarchy.js'
import * as org from '../services/orgTree.js'
import { asyncHandler, unprocessable } from '../utils/http.js'
import { COMPLAINT_INCLUDE, publicComplaint, publicUser } from '../utils/serialize.js'

export const citizenRouter: Router = Router()

citizenRouter.use(authenticate)

/**
 * Where the caller lives, resolved to the full chain.
 *
 * Returns null rather than throwing when no home sector is set — a citizen who
 * skipped it at registration should be asked to fill it in, not shown an error.
 */
async function homeContext(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { homeUnitId: true, homeUnit: true },
  })
  if (!user?.homeUnit) return null

  const unit = user.homeUnit
  const ancestors = await org.getAncestors(prisma, unit)
  const parent = ancestors[ancestors.length - 1] ?? null

  return {
    unitId: unit.id,
    unitName: unit.name,
    unitKind: unit.kindLabel,
    /** The ring outward — where a complaint goes if this layer does nothing. */
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? null,
    parentKind: parent?.kindLabel ?? null,
    /** Root-first, so a screen can print "Noida / Zone III / Sector 5". */
    trail: [...ancestors, unit].map((u) => ({
      id: u.id,
      name: u.name,
      kindLabel: u.kindLabel,
    })),
  }
}

/** The "you have not told us where you live" response, said once. */
const NO_HOME = {
  home: null,
  needsHomeSector: true,
  message: 'Set your sector on your profile and this page will fill in.',
}

// ---------------------------------------------------------------------------
// Community grievances
// ---------------------------------------------------------------------------

/**
 * Open community grievances near the caller.
 *
 * Their own area first, then the ring outward — a blocked trunk drain two
 * sectors over is still the reader's problem, and the layer above is where an
 * officer with charge of both would fix it.
 *
 * Scoped by the tree rather than by a named tier, so this keeps working
 * whatever depth the authority is configured to.
 */
citizenRouter.get(
  '/community',
  validate(z.object({ scope: z.enum(['unit', 'area']).default('area') }), 'query'),
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const home = await homeContext(actor.id)
    if (!home) return res.json({ ...NO_HOME, items: [] })

    const { scope } = req.query as unknown as { scope: 'unit' | 'area' }

    // "area" widens to the parent's whole subtree; with no parent (a
    // single-layer authority) it is the same thing as "unit".
    const unitIds =
      scope === 'unit' || home.parentId == null
        ? [home.unitId]
        : await org.getSubtreeIds(prisma, home.parentId)

    const where: Prisma.ComplaintWhereInput = {
      isCommunity: true,
      status: { in: OPEN_STATUSES },
      orgUnitId: { in: unitIds },
    }

    const complaints = await prisma.complaint.findMany({
      where,
      include: {
        ...COMPLAINT_INCLUDE,
        supports: { select: { userId: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    })

    const items = await Promise.all(
      complaints.map(async (c) => {
        const supporters = c.supports.length
        return {
          ...publicComplaint(c),
          isCommunity: true,
          supporters,
          // Whether *this* reader has already spoken, so the button can say so
          // rather than letting them press it and be refused.
          viewerHasSupported: c.supports.some((s) => s.userId === actor.id),
          viewerIsAuthor: c.citizenId === actor.id,
          nextThreshold: await nextThreshold(prisma, c.id),
          inMySector: c.orgUnitId === home.unitId,
        }
      }),
    )

    res.json({
      home,
      needsHomeSector: false,
      scope,
      items: items.sort(
        // Nearest first, then best-backed: a reader scrolling this list is
        // looking for their own street before anything else.
        (a, b) => Number(b.inMySector) - Number(a.inMySector) || b.supporters - a.supporters,
      ),
    })
  }),
)

/**
 * Open grievances near the caller that resemble what they are about to file.
 *
 * Shown before a complaint is submitted. The aim is not to block filing — a
 * resident who insists their pothole is a different pothole must always be able
 * to say so — but to offer the better option first, because one grievance with
 * eleven backers moves and twelve identical complaints do not.
 */
citizenRouter.get(
  '/similar',
  validate(
    z.object({
      categoryId: z.coerce.number().int().positive().optional(),
      q: z.string().max(500).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const home = await homeContext(actor.id)
    if (!home) return res.json({ items: [] })

    const { categoryId, q } = req.query as unknown as { categoryId?: number; q?: string }

    // Words long enough to mean something. Matching on "the" or "hai" would
    // return the whole sector and teach the reader to ignore this panel.
    const words = (q ?? '')
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((w) => w.length >= 4)
      .slice(0, 6)

    if (!categoryId && words.length === 0) return res.json({ items: [] })

    const complaints = await prisma.complaint.findMany({
      where: {
        orgUnitId: home.unitId,
        status: { in: OPEN_STATUSES },
        citizenId: { not: actor.id },
        OR: [
          ...(categoryId ? [{ categoryId }] : []),
          ...words.map((w) => ({
            title: { contains: w, mode: 'insensitive' as const },
          })),
        ],
      },
      include: { ...COMPLAINT_INCLUDE, supports: { select: { userId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })

    res.json({
      items: complaints.map((c) => ({
        ...publicComplaint(c),
        isCommunity: c.isCommunity,
        supporters: c.supports.length,
        viewerHasSupported: c.supports.some((s) => s.userId === actor.id),
      })),
    })
  }),
)

// ---------------------------------------------------------------------------
// Works near me
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Who answers for me
// ---------------------------------------------------------------------------

/**
 * The caller's officers, by department.
 *
 * Field workers are excluded deliberately. A resident should not be knocking on
 * a safai karamchari's door about a policy failure — the Sanitary Inspector is
 * the person accountable for the sector, and the rungs above them are who the
 * complaint reaches if that inspector does not act. Showing the whole ladder is
 * the point: it is what makes the escalation promise checkable.
 */
citizenRouter.get(
  '/officers',
  asyncHandler(async (req, res) => {
    const home = await homeContext(req.user!.id)
    if (!home) return res.json({ ...NO_HOME, departments: [] })

    // Everyone whose charge covers where this person lives: the officer at
    // their own layer, and every layer above it. Read off the tree, so it is
    // the same chain a complaint would actually climb.
    const chain = home.trail.map((t) => t.id)
    const depthByUnit = new Map(home.trail.map((t, index) => [t.id, index]))

    const postings = await prisma.posting.findMany({
      where: {
        endedAt: null,
        departmentId: { not: null },
        department: { status: 'ACTIVE' },
        orgUnitId: { in: chain },
        user: { isActive: true },
      },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true } },
        department: { select: { id: true, name: true, nameHi: true, icon: true } },
        orgUnit: { select: { id: true, name: true, kindLabel: true, depth: true } },
      },
      orderBy: [{ departmentId: 'asc' }],
    })

    const byDepartment = new Map<number, typeof postings>()
    for (const p of postings) {
      if (!p.departmentId) continue
      const list = byDepartment.get(p.departmentId) ?? []
      list.push(p)
      byDepartment.set(p.departmentId, list)
    }

    const label = (p: (typeof postings)[number]) =>
      p.orgUnit ? `${p.orgUnit.kindLabel} ${p.orgUnit.name}` : 'Authority-wide'

    const person = (p: (typeof postings)[number]) => ({
      userId: p.user.id,
      fullName: p.user.fullName,
      email: p.user.email,
      phone: p.user.phone,
      rank: p.rank,
      rankLabel: RANK_LABEL[p.rank],
      designationTitle: p.designationTitle ?? RANK_LABEL[p.rank],
      unit: p.orgUnit,
      jurisdictionLabel: label(p),
    })

    const departments = [...byDepartment.values()].map((list) => {
      // Nearest to the resident first — that is who to approach. Everyone after
      // them is, literally, who it reaches if nothing is done.
      const ordered = [...list].sort(
        (a, b) =>
          (depthByUnit.get(b.orgUnitId ?? -1) ?? -1) - (depthByUnit.get(a.orgUnitId ?? -1) ?? -1) ||
          RANK_LEVEL[a.rank] - RANK_LEVEL[b.rank],
      )
      const first = ordered[0]!

      return {
        department: first.department!,
        /** The one to approach. Everything above them is escalation. */
        directHead: person(first),
        escalatesTo: ordered.slice(1).map(person),
      }
    })

    res.json({ home, needsHomeSector: false, departments })
  }),
)

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

citizenRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const actor = req.user!

    const [user, home, filed, open, resolved, supported, rated] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        include: {
          homeSector: true,
          postings: {
            where: { endedAt: null },
            include: { department: true, zone: true, circle: true, sector: true },
          },
        },
      }),
      homeContext(actor.id),
      prisma.complaint.count({ where: { citizenId: actor.id } }),
      prisma.complaint.count({ where: { citizenId: actor.id, status: { in: OPEN_STATUSES } } }),
      prisma.complaint.count({
        where: { citizenId: actor.id, status: { in: ['RESOLVED', 'CLOSED'] } },
      }),
      prisma.complaintSupport.count({ where: { userId: actor.id } }),
      prisma.complaint.aggregate({
        where: { citizenId: actor.id, feedbackRating: { not: null } },
        _avg: { feedbackRating: true },
      }),
    ])

    res.json({
      user: publicUser(user),
      home,
      activity: {
        filed,
        open,
        resolved,
        supported,
        avgRatingGiven: rated._avg.feedbackRating,
      },
    })
  }),
)

citizenRouter.patch(
  '/profile',
  validate(
    z.object({
      fullName: z.string().min(2).max(128).optional(),
      phone: z.string().max(20).nullable().optional(),
      homeUnitId: z.number().int().positive().nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const actor = req.user!
    const input = req.body as {
      fullName?: string
      phone?: string | null
      homeUnitId?: number | null
    }

    const changes: Record<string, unknown> = { ...input }

    if (input.homeUnitId != null) {
      const unit = await prisma.orgUnit.findUnique({ where: { id: input.homeUnitId } })
      if (!unit || !unit.isActive) throw unprocessable('That area does not exist')
      // A resident lives at the ground floor, never at an oversight layer:
      // routing dispatches from there, so anywhere else would strand their
      // complaints one level up from anyone who can act on them.
      if (!unit.isLeaf) throw unprocessable('Choose the specific area you live in')

      // Keep the legacy column in step while older code still reads it.
      const match = unit.code.match(/^SEC-(\d+)$/)
      const sector = match
        ? await prisma.sector.findUnique({ where: { number: Number(match[1]) } })
        : null
      changes.homeSectorId = sector?.id ?? null
    } else if (input.homeUnitId === null) {
      changes.homeSectorId = null
    }

    const user = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: actor.id },
        data: changes,
        include: {
          homeSector: true,
          postings: {
            where: { endedAt: null },
            include: { department: true, zone: true, circle: true, sector: true },
          },
        },
      })
      // Where someone lives decides which officer answers for them and which
      // grievances they may back, so a change to it belongs in the trail.
      await audit.record(tx, {
        action: 'profile.updated',
        entityType: 'user',
        entityId: actor.id,
        payload: { changes: changes as Record<string, unknown> },
        actorId: actor.id,
        actorLabel: actor.fullName,
      })
      return saved
    })

    res.json(publicUser(user))
  }),
)
