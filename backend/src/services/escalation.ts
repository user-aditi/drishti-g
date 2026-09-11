/**
 * The escalation ladder — Layer 2, and the only place its rules live.
 *
 * NYC 311 has no escalation: a request sits with its agency until the agency
 * closes it (F-12). Layer 2 adds a ladder inside each agency. At rung 0 the
 * accountable officer holds the request alone. Past its derived deadline it
 * reaches rung 1, the agency's supervisor; past twice its service level, rung 2,
 * the borough commissioner. Escalating pulls someone senior in beside the officer;
 * it never takes the request away from them.
 *
 * The gate is that the automatic trigger fires on breach and only on breach —
 * never at or before the deadline, and never skipping a rung. A request found far
 * past both thresholds climbs both, each recorded, rather than jumping.
 *
 * What the sweep may touch is the other half of it (I6). A request filed through
 * this system is live. An imported request is NYC's history and is left alone —
 * every open one is past its deadline at the snapshot, and escalating 6,315 of
 * them the first time the sweep ran would be reacting today to delays New York
 * lived through years ago — unless this system has since acted on it, at which
 * point it is live work and the ladder applies.
 */
import {
  EscalationTrigger,
  Prisma,
  RequestStatus,
  Role,
  type PrismaClient,
} from '@prisma/client'
import * as audit from './audit.js'

type Db = PrismaClient | Prisma.TransactionClient

export const TOP_LEVEL = 2

const ROLE_AT: Record<number, Role> = { 1: Role.SUPERVISOR, 2: Role.COMMISSIONER }

export const LEVEL_NAME: Record<number, string> = {
  0: 'officer',
  1: 'supervisor',
  2: 'borough commissioner',
}

/** Requests the ladder applies to — see the module comment on I6. */
export const LIVE: Prisma.ServiceRequestWhereInput = {
  OR: [{ isImported: false }, { history: { some: { actorId: { not: null } } } }],
}

/** Who holds a rung in an agency: the lowest-numbered active holder, reproducibly. */
export async function seniorFor(
  db: Db,
  agencyId: number,
  level: number,
): Promise<{ id: number; name: string } | null> {
  const role = ROLE_AT[level]
  if (!role) return null
  return db.user.findFirst({
    where: { role, isActive: true, postings: { some: { agencyId, endedAt: null } } },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })
}

/**
 * The rung a request should have reached by `now`.
 *
 * Strictly after the deadline, never at it: "on breach and only on breach" means
 * a request due at 14:00 is not escalated at 14:00. Rung 2 comes when the
 * request has been open for twice its service level.
 */
export function levelDue(request: { createdAt: Date; slaDueAt: Date }, now: Date): number {
  const due = request.slaDueAt.getTime()
  if (now.getTime() <= due) return 0
  const serviceLevel = due - request.createdAt.getTime()
  return now.getTime() > due + serviceLevel ? 2 : 1
}

export interface EscalateInput {
  requestId: number
  agencyId: number
  fromLevel: number
  toLevel: number
  trigger: EscalationTrigger
  reason: string
  /** Null when the sweep raised it. */
  raisedById: number | null
  raisedByLabel: string
  at: Date
}

/**
 * Climb one rung, record it, and put it on the chain — in the caller's
 * transaction.
 *
 * No status-history row. An escalation is not a status change, and that table
 * feeds the process-mining event log; putting our escalations in it would give
 * NYC's lifecycle a step it does not have.
 */
export async function escalate(tx: Prisma.TransactionClient, input: EscalateInput): Promise<void> {
  const senior = await seniorFor(tx, input.agencyId, input.toLevel)
  await tx.escalation.create({
    data: {
      requestId: input.requestId,
      fromLevel: input.fromLevel,
      toLevel: input.toLevel,
      trigger: input.trigger,
      reason: input.reason,
      raisedById: input.raisedById,
      toUserId: senior?.id ?? null,
      at: input.at,
    },
  })
  await tx.serviceRequest.update({
    where: { id: input.requestId },
    data: { escalationLevel: input.toLevel },
  })
  await audit.record(tx, {
    action: 'request.escalated',
    entityType: 'request',
    entityId: input.requestId,
    payload: {
      fromLevel: input.fromLevel,
      toLevel: input.toLevel,
      trigger: input.trigger,
      reason: input.reason,
      reached: senior?.name ?? null,
    },
    actorId: input.raisedById,
    actorLabel: input.raisedByLabel,
    source: input.raisedById === null ? 'system' : 'api',
  })
}

/**
 * One pass of the automatic trigger.
 *
 * Each request climbs in its own transaction, so one failure costs one request
 * rather than the pass. Two sweeps running at once — a slow pass overlapping the
 * next tick, or two server processes — cannot double a rung: the database's
 * unique (request, rung) pair refuses the second writer, and that refusal is
 * treated as "already done", not as an error.
 */
export async function sweep(db: PrismaClient, now: Date = new Date()) {
  const candidates = await db.serviceRequest.findMany({
    where: {
      AND: [
        LIVE,
        {
          status: { not: RequestStatus.CLOSED },
          escalationLevel: { lt: TOP_LEVEL },
          slaDueAt: { lt: now },
        },
      ],
    },
    select: { id: true, agencyId: true, createdAt: true, slaDueAt: true, escalationLevel: true },
  })

  let rungs = 0
  let requests = 0
  for (const request of candidates) {
    const target = levelDue({ createdAt: request.createdAt, slaDueAt: request.slaDueAt! }, now)
    if (target <= request.escalationLevel) continue
    try {
      await db.$transaction(async (tx) => {
        for (let level = request.escalationLevel + 1; level <= target; level++) {
          await escalate(tx, {
            requestId: request.id,
            agencyId: request.agencyId,
            fromLevel: level - 1,
            toLevel: level,
            trigger: EscalationTrigger.SLA_BREACH,
            reason:
              level === 1
                ? 'Past its derived deadline'
                : 'Open for more than twice its derived service level',
            raisedById: null,
            raisedByLabel: 'escalation sweep',
            at: now,
          })
        }
      })
      rungs += target - request.escalationLevel
      requests++
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
  return { rungs, requests, considered: candidates.length }
}

/**
 * Run the sweep on a timer, never overlapping itself.
 *
 * Returns a stop function. A pass still running when the next tick comes is
 * left to finish, and the tick is skipped rather than queued: the next pass will
 * see anything this one missed.
 */
export function startEscalationSweep(
  db: PrismaClient,
  intervalMs: number,
  log: (message: string) => void,
): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const result = await sweep(db)
      if (result.rungs > 0) {
        log(`escalation sweep: ${result.rungs} rung(s) climbed across ${result.requests} request(s)`)
      }
    } catch (err) {
      log(`escalation sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  void tick()
  return () => clearInterval(timer)
}
