import { RequestStatus, type Prisma, type ServiceRequest } from '@prisma/client'
import { badRequest, notFound } from '../utils/http.js'
import * as audit from './audit.js'
import { notify } from './notifications.js'
import { runStatusChangedHooks, type StatusChange } from './requestHooks.js'

/**
 * Moving a request between NYC's statuses — the one transition every writer
 * shares.
 *
 * It used to live inside the agency queue's route, which made that route the
 * only way a request could ever be closed. When a later layer needed someone
 * else to close requests, the choice was between copying the transition — and
 * letting the history rows, the audit entry and the closedAt rule drift apart
 * between two copies — or pulling it out. This is it, pulled out.
 *
 * It decides nothing about *who* may make the change. Each caller checks that
 * before calling, because the rule differs by caller and this file is the
 * baseline's: it knows NYC's statuses and nothing added on top of them (N5).
 *
 * Runs in the caller's transaction, so the update, its history row, its audit
 * entry and anything a later layer attached with `onStatusChanged` commit or
 * fail together.
 */
export interface StatusChangeInput {
  requestId: number
  status: RequestStatus
  /** The resolution note, in the agency's words. Omitted leaves the existing one. */
  note?: string
  actorId: number
  actorLabel: string
  at?: Date
}

export async function changeStatus(
  tx: Prisma.TransactionClient,
  input: StatusChangeInput,
): Promise<{ request: ServiceRequest; from: RequestStatus }> {
  const at = input.at ?? new Date()

  const existing = await tx.serviceRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, srNumber: true, status: true, closedAt: true },
  })
  if (!existing) throw notFound('No such request')
  if (existing.status === input.status) {
    throw badRequest('The request is already in that status')
  }

  const request = await tx.serviceRequest.update({
    where: { id: input.requestId },
    data: {
      status: input.status,
      resolutionNote: input.note ?? undefined,
      // Closing stamps a real time; reopening clears it, so "closed" and "has a
      // closedAt" can never disagree.
      closedAt: input.status === RequestStatus.CLOSED ? (existing.closedAt ?? at) : null,
    },
  })

  await tx.requestStatusHistory.create({
    data: {
      requestId: input.requestId,
      fromStatus: existing.status,
      toStatus: input.status,
      at,
      actorId: input.actorId,
      note: input.note ?? null,
    },
  })

  await audit.record(tx, {
    action: 'request.status_changed',
    entityType: 'request',
    entityId: input.requestId,
    payload: { srNumber: existing.srNumber, from: existing.status, to: input.status },
    actorId: input.actorId,
    actorLabel: input.actorLabel,
  })

  await runStatusChangedHooks(tx, {
    request,
    from: existing.status,
    to: input.status,
    at,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
  })

  return { request, from: existing.status }
}

const STATUS_WORDS: Record<RequestStatus, string> = {
  OPEN: 'open',
  ASSIGNED: 'assigned',
  STARTED: 'started',
  IN_PROGRESS: 'in progress',
  PENDING: 'pending',
  CLOSED: 'closed',
  UNSPECIFIED: 'unspecified',
}

/**
 * Tell the resident who reported a request that its status changed. Registered
 * as a status-change hook in app.ts.
 *
 * Not when they made the change themselves, and not for anonymous filings —
 * there is nobody to tell, which is the ordinary case for a 311 phone call.
 */
export async function tellReporter(tx: Prisma.TransactionClient, change: StatusChange): Promise<void> {
  const citizenId = change.request.citizenId
  if (citizenId === null || citizenId === change.actorId) return
  const words = STATUS_WORDS[change.to]
  await notify(tx, {
    userId: citizenId,
    kind: 'request.status_changed',
    title: `${change.request.srNumber} is now ${words}`,
    body:
      change.to === RequestStatus.CLOSED
        ? change.request.resolutionNote ?? 'The agency closed your request.'
        : `It was ${STATUS_WORDS[change.from]}.`,
    href: `/sr/${change.request.srNumber}`,
  })
}
