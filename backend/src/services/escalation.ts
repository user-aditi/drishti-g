/**
 * Escalation — what makes the hierarchy accountable rather than decorative.
 *
 * A complaint that blows its deadline stops being the leaf unit's problem and
 * becomes its parent's, then its parent's, up to the city. Each step notifies
 * the officer who inherits it and is written to the audit trail, so "nobody
 * told me" stops being available as an answer.
 *
 * There is no ladder here any more. Escalating is walking to `parentId`, so a
 * department running two layers and one running five behave identically without
 * a line of code changing. How long a complaint may sit at each layer comes
 * from that department's `DepartmentLayer` row, which the super admin sets.
 *
 * This is the mechanism the paper's premise depends on: GRIE can only measure
 * missed deadlines meaningfully if missing one actually does something.
 */
import { createLogger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import * as audit from './audit.js'
import { OPEN_STATUSES } from './gcce.js'
import * as org from './orgTree.js'

const log = createLogger('escalation')

export interface EscalationResult {
  complaintId: number
  referenceNo: string
  fromUnitId: number
  fromUnitName: string
  toUnitId: number
  toUnitName: string
  toUserId: number | null
  hoursOverdue: number
}

/**
 * Escalate one complaint by a single step, up the tree.
 *
 * Returns null when it is not actually overdue, when it is already at the root,
 * or when nobody is posted above — escalating into a vacancy would hide the
 * complaint rather than surface it.
 *
 * The overdue check lives here rather than only in the sweep. Escalation is the
 * one mechanism that makes a missed deadline cost something, so a complaint that
 * climbs without having missed one would corrupt exactly the signal GRIE is
 * built to measure.
 */
export async function escalateOne(complaintId: number): Promise<EscalationResult | null> {
  const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } })
  if (!complaint || complaint.slaDueAt == null) return null
  if (!OPEN_STATUSES.includes(complaint.status)) return null
  if (complaint.departmentId == null || complaint.orgUnitId == null) return null
  if (complaint.slaDueAt.getTime() > Date.now()) return null

  const fromUnit = await org.getUnit(prisma, complaint.orgUnitId)
  if (!fromUnit) return null

  const toUnit = await org.parentOf(prisma, fromUnit.id)
  if (!toUnit) return null // already at the city; nothing above it

  // Find whoever is posted at the parent, falling further up if that post is
  // vacant. findOwnerFor walks the chain for us.
  const officer = await org.findOwnerFor(prisma, {
    unitId: toUnit.id,
    departmentId: complaint.departmentId,
  })
  if (!officer) {
    log.warn(
      `cannot escalate ${complaint.referenceNo}: nobody posted at or above ${toUnit.name} for this department`,
    )
    return null
  }

  // The complaint lands wherever we actually found someone, which may be higher
  // than the immediate parent.
  const landingUnitId = officer.unitId
  const landingUnit =
    landingUnitId === toUnit.id ? toUnit : ((await org.getUnit(prisma, landingUnitId)) ?? toUnit)

  const hoursOverdue = Math.max(
    0,
    Math.round((Date.now() - complaint.slaDueAt.getTime()) / 3_600_000),
  )
  const reason = `Unresolved ${hoursOverdue} hour${hoursOverdue === 1 ? '' : 's'} past its ${fromUnit.kindLabel} deadline.`

  // The new deadline is this layer's allowance, so each layer gets a fair and
  // configured window rather than inheriting an already-expired one.
  const nextSla = await org.slaHoursFor(prisma, {
    unitId: landingUnit.id,
    departmentId: complaint.departmentId,
  })
  const nextDueAt = nextSla != null ? new Date(Date.now() + nextSla * 3_600_000) : null

  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        orgUnitId: landingUnit.id,
        assignedOfficerId: officer.userId,
        escalationLevel: complaint.escalationLevel + 1,
        // Escalation raises urgency: it has already failed once below.
        priority: complaint.priority === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        ...(nextDueAt ? { slaDueAt: nextDueAt } : {}),
      },
    })

    await tx.escalation.create({
      data: {
        complaintId: complaint.id,
        fromUnitId: fromUnit.id,
        toUnitId: landingUnit.id,
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
        note: `Escalated from ${fromUnit.kindLabel} ${fromUnit.name} to ${landingUnit.kindLabel} ${landingUnit.name}. ${reason}`,
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
        fromUnitId: fromUnit.id,
        fromUnit: fromUnit.name,
        toUnitId: landingUnit.id,
        toUnit: landingUnit.name,
        toUserId: officer.userId,
        hoursOverdue,
        escalationLevel: complaint.escalationLevel + 1,
      },
      actorLabel: 'GCCE escalation',
      source: 'gcce',
    })
  })

  log.info(
    `escalated ${complaint.referenceNo}: ${fromUnit.name} -> ${landingUnit.name} (${officer.fullName})`,
  )

  return {
    complaintId: complaint.id,
    referenceNo: complaint.referenceNo,
    fromUnitId: fromUnit.id,
    fromUnitName: fromUnit.name,
    toUnitId: landingUnit.id,
    toUnitName: landingUnit.name,
    toUserId: officer.userId,
    hoursOverdue,
  }
}

/**
 * Sweep every overdue complaint and escalate it one step.
 *
 * A complaint stops climbing when it reaches the root — the tree itself is the
 * termination condition, so no maximum-level constant is needed.
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
      orgUnitId: { not: null },
      // Anything already at the city has nowhere left to go.
      orgUnit: { parentId: { not: null } },
    },
    select: { id: true },
  })

  const escalated: EscalationResult[] = []
  for (const complaint of overdue) {
    const result = await escalateOne(complaint.id)
    if (result) escalated.push(result)
  }

  log.info(`sweep checked ${overdue.length} overdue complaints, escalated ${escalated.length}`)
  return { checked: overdue.length, escalated }
}
