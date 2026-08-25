/**
 * Escalation — what makes the hierarchy accountable rather than decorative.
 *
 * A complaint that blows its deadline stops being only the Junior Engineer's
 * problem and becomes the Executive Engineer's, then the Superintending
 * Engineer's, then the General Manager's. Each step notifies the officer who
 * inherits it and is written to the audit trail, so "nobody told me" stops
 * being available as an answer.
 *
 * This is the mechanism the paper's premise depends on: GRIE can only measure
 * missed deadlines meaningfully if missing one actually does something.
 */
import { Rank } from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import * as audit from './audit.js'
import { OPEN_STATUSES } from './gcce.js'
import { findResponsibleOfficer, nextRankUp, RANK_LABEL } from './hierarchy.js'

const log = createLogger('escalation')

/**
 * Hours past the deadline before each successive escalation fires.
 *
 * Deliberately widening: the first escalation is quick because the JE may
 * simply have missed it, later ones are slower because a General Manager
 * receiving a same-day pothole would stop reading the queue.
 */
const ESCALATION_DELAYS_HOURS = [0, 48, 120]

export interface EscalationResult {
  complaintId: number
  referenceNo: string
  fromRank: Rank
  toRank: Rank
  toUserId: number | null
  hoursOverdue: number
}

/**
 * Escalate one complaint by a single step.
 *
 * Returns null when it is already at the top of the ladder, or when nobody
 * holds the post above — escalating into a vacancy would hide the complaint.
 */
export async function escalateOne(complaintId: number): Promise<EscalationResult | null> {
  const complaint = await prisma.complaint.findUnique({
    where: { id: complaintId },
    include: { assignedOfficer: { include: { postings: { where: { endedAt: null } } } } },
  })
  if (!complaint || complaint.slaDueAt == null) return null
  if (!OPEN_STATUSES.includes(complaint.status)) return null
  if (complaint.departmentId == null || complaint.sectorId == null) return null

  const currentRank =
    complaint.assignedOfficer?.postings.find((p) => p.departmentId === complaint.departmentId)
      ?.rank ?? Rank.SECTION_OFFICER

  const toRank = nextRankUp(currentRank)
  if (toRank == null) return null

  const officer = await findResponsibleOfficer(prisma, {
    departmentId: complaint.departmentId,
    sectorId: complaint.sectorId,
    rank: toRank,
  })
  if (!officer) {
    log.warn(
      `cannot escalate ${complaint.referenceNo}: no ${RANK_LABEL[toRank]} posted for this area`,
    )
    return null
  }

  const hoursOverdue = Math.max(
    0,
    Math.round((Date.now() - complaint.slaDueAt.getTime()) / 3_600_000),
  )
  const reason = `Unresolved ${hoursOverdue} hour${hoursOverdue === 1 ? '' : 's'} past its ${RANK_LABEL[currentRank]} deadline.`

  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        assignedOfficerId: officer.userId,
        escalationLevel: complaint.escalationLevel + 1,
        // Escalation raises urgency: it has already failed once at this level.
        priority: complaint.priority === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      },
    })

    await tx.escalation.create({
      data: {
        complaintId: complaint.id,
        fromRank: currentRank,
        toRank,
        toUserId: officer.userId,
        reason,
        hoursOverdue,
      },
    })

    await tx.complaintStatusHistory.create({
      data: {
        complaintId: complaint.id,
        fromStatus: complaint.status,
        toStatus: complaint.status,
        note: `Escalated from ${RANK_LABEL[currentRank]} to ${RANK_LABEL[toRank]}. ${reason}`,
      },
    })

    await tx.notification.create({
      data: {
        userId: officer.userId,
        title: `Escalated to you: ${complaint.referenceNo}`,
        body: `${complaint.title} — ${reason} It is now your responsibility.`,
        link: `/complaints/${complaint.id}`,
      },
    })

    await audit.record(tx, {
      action: 'complaint.escalated',
      entityType: 'complaint',
      entityId: complaint.id,
      payload: {
        fromRank: currentRank,
        toRank,
        toUserId: officer.userId,
        hoursOverdue,
        escalationLevel: complaint.escalationLevel + 1,
      },
      actorLabel: 'GCCE escalation',
      source: 'gcce',
    })
  })

  log.info(
    `escalated ${complaint.referenceNo}: ${RANK_LABEL[currentRank]} -> ${RANK_LABEL[toRank]} (${officer.fullName})`,
  )

  return {
    complaintId: complaint.id,
    referenceNo: complaint.referenceNo,
    fromRank: currentRank,
    toRank,
    toUserId: officer.userId,
    hoursOverdue,
  }
}

/**
 * Sweep every overdue complaint and escalate the ones that have waited long
 * enough for their current escalation level.
 *
 * Run on a schedule in production; exposed as an endpoint so it can be
 * triggered on demand for a demo.
 */
export async function runEscalationSweep(): Promise<{
  checked: number
  escalated: EscalationResult[]
}> {
  const now = new Date()

  const overdue = await prisma.complaint.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      slaDueAt: { lt: now },
      // Already at the top of the ladder — nothing above HOD to escalate to.
      escalationLevel: { lt: ESCALATION_DELAYS_HOURS.length },
    },
    select: { id: true, slaDueAt: true, escalationLevel: true },
  })

  const escalated: EscalationResult[] = []

  for (const complaint of overdue) {
    const hoursOverdue = (now.getTime() - complaint.slaDueAt!.getTime()) / 3_600_000
    const threshold = ESCALATION_DELAYS_HOURS[complaint.escalationLevel]
    if (threshold == null || hoursOverdue < threshold) continue

    const result = await escalateOne(complaint.id)
    if (result) escalated.push(result)
  }

  log.info(`sweep checked ${overdue.length} overdue complaints, escalated ${escalated.length}`)
  return { checked: overdue.length, escalated }
}
