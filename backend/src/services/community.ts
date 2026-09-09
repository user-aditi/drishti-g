/**
 * Community grievances: what happens when neighbours back one another.
 *
 * A private complaint is one household's problem. A community grievance is the
 * street's, and the authority should be able to tell the difference without
 * anyone at a desk having to judge it. Support is how the street says so, and
 * this module is the rule that turns that support into something the system
 * acts on.
 *
 * Support does not set priority by itself. It is one of the seven inputs
 * `priority.ts` weighs, which is what lets a citizen be told exactly what their
 * backing did and an officer read why a complaint is suddenly Critical.
 */
import { Prisma, Priority } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import * as audit from './audit.js'
import { applyPriority, supportsNeededForNextBand } from './priority.js'

const PRIORITY_RANK: Record<Priority, number> = {
  [Priority.LOW]: 0,
  [Priority.MEDIUM]: 1,
  [Priority.HIGH]: 2,
  [Priority.CRITICAL]: 3,
}

export type Db = PrismaClient | Prisma.TransactionClient

/**
 * How many more neighbours would move this up a band.
 *
 * Delegates to the priority service, which simulates the score rather than
 * consulting a table — so the promise a citizen is shown stays true even though
 * urgency depends on six things besides support.
 */
export async function nextThreshold(
  db: Db,
  complaintId: number,
): Promise<{ supporters: number; priority: Priority; remaining: number } | null> {
  const next = await supportsNeededForNextBand(db, complaintId)
  if (!next) return null
  return { supporters: next.remaining, priority: next.priority, remaining: next.remaining }
}

/**
 * Recompute a grievance's priority now that its backing has changed.
 *
 * Support used to raise priority through a threshold table of its own. It no
 * longer does: `priority.ts` is the single place urgency is decided, and the
 * number of neighbours backing a grievance is one of the seven things it weighs.
 * Two mechanisms both writing `priority` was a bug waiting to happen, and it
 * made "why is this High?" unanswerable.
 */

export interface SupportOutcome {
  supporters: number
  /** Set when this particular support crossed a threshold. */
  raisedTo: Priority | null
}

/**
 * Recompute a grievance's priority from its support, and record why if it moved.
 *
 * Only ever raises. An officer who has judged something Critical for reasons of
 * their own must not have it walked back down because a supporter withdrew, and
 * a grievance that briefly had fifteen backers was still a grievance fifteen
 * households had.
 */
export async function applySupportPriority(
  tx: Db,
  complaintId: number,
  actor: { id: number; fullName: string } | null,
): Promise<SupportOutcome> {
  const [before, supporters] = await Promise.all([
    tx.complaint.findUniqueOrThrow({
      where: { id: complaintId },
      select: {
        priority: true,
        referenceNo: true,
        title: true,
        status: true,
        assignedOfficerId: true,
      },
    }),
    tx.complaintSupport.count({ where: { complaintId } }),
  ])

  const result = await applyPriority(tx, complaintId)
  if (PRIORITY_RANK[result.priority] <= PRIORITY_RANK[before.priority]) {
    return { supporters, raisedTo: null }
  }

  const reason = `Raised to ${result.priority.toLowerCase()} — ${supporters} residents have backed this grievance.`

  await tx.complaintStatusHistory.create({
    data: {
      complaintId,
      // The status has not moved, only the urgency; recording it here is what
      // puts the change on the citizen-visible timeline beside everything else.
      fromStatus: null,
      toStatus: before.status,
      actorId: actor?.id ?? null,
      note: reason,
    },
  })

  await audit.record(tx, {
    action: 'complaint.priority_raised_by_support',
    entityType: 'complaint',
    entityId: complaintId,
    payload: {
      supporters,
      from: before.priority,
      to: result.priority,
      score: result.score,
    },
    actorId: actor?.id ?? null,
    actorLabel: actor?.fullName ?? 'Community support',
    source: 'system',
  })

  // The officer holding it should hear that the street has spoken, not discover
  // a re-prioritised complaint in their queue with no explanation.
  if (before.assignedOfficerId) {
    await tx.notification.create({
      data: {
        userId: before.assignedOfficerId,
        title: `Now ${result.priority.toLowerCase()}: ${before.title}`,
        body: `${supporters} residents have backed ${before.referenceNo}. ${reason}`,
        link: '/officer/desk',
      },
    })
  }

  return { supporters, raisedTo: result.priority }
}
