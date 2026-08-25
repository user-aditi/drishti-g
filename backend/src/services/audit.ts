/**
 * Append-only audit log with a hash chain.
 *
 * Each event's hash covers its own canonical content plus the previous event's
 * hash. Editing or deleting any historical row breaks every hash after it,
 * which `verifyChain` detects. Same integrity guarantee the plan wanted from
 * blockchain, without a distributed ledger.
 */
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

export const GENESIS = '0'.repeat(64)

/** Any Prisma client or an interactive transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient

interface CanonicalInput {
  actorId: number | null
  action: string
  entityType: string
  entityId: string
  payload: unknown
  source: string
  prevHash: string
}

/**
 * Stable string form of an event.
 *
 * Key order matters: the same event must serialise byte-identically every time
 * or verification reports false tampering. JSON.stringify preserves insertion
 * order, so payload keys are sorted explicitly.
 */
function canonical(input: CanonicalInput): string {
  return JSON.stringify({
    action: input.action,
    actorId: input.actorId,
    entityId: input.entityId,
    entityType: input.entityType,
    payload: sortDeep(input.payload),
    prevHash: input.prevHash,
    source: input.source,
  })
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

function digest(input: CanonicalInput): string {
  return createHash('sha256').update(canonical(input)).digest('hex')
}

export interface RecordInput {
  action: string
  entityType: string
  entityId: string | number
  payload?: Record<string, unknown>
  actorId?: number | null
  actorLabel?: string | null
  source?: 'api' | 'gcce' | 'grie' | 'system'
}

/**
 * Append one event.
 *
 * Must run inside the same transaction as the action it records, so an action
 * and its audit entry either both land or neither does. Reading the head hash
 * inside that transaction is also what keeps the chain linear under concurrent
 * writes.
 */
export async function record(db: Db, input: RecordInput) {
  const previous = await db.auditEvent.findFirst({
    orderBy: { id: 'desc' },
    select: { hash: true },
  })
  const prevHash = previous?.hash ?? GENESIS

  const canonicalInput: CanonicalInput = {
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: String(input.entityId),
    payload: input.payload ?? {},
    source: input.source ?? 'api',
    prevHash,
  }

  return db.auditEvent.create({
    data: {
      actorId: canonicalInput.actorId,
      actorLabel: input.actorLabel ?? null,
      action: canonicalInput.action,
      entityType: canonicalInput.entityType,
      entityId: canonicalInput.entityId,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      source: canonicalInput.source,
      prevHash,
      hash: digest(canonicalInput),
    },
  })
}

export interface ChainResult {
  valid: boolean
  checked: number
  head?: string
  brokenAtId?: number
  reason?: string
}

/** Walk the whole chain and report the first row that does not verify. */
export async function verifyChain(db: Db): Promise<ChainResult> {
  const events = await db.auditEvent.findMany({ orderBy: { id: 'asc' } })
  let expectedPrev = GENESIS

  for (const event of events) {
    if ((event.prevHash ?? GENESIS) !== expectedPrev) {
      return {
        valid: false,
        checked: events.length,
        brokenAtId: event.id,
        reason: 'This entry does not link to the one before it — a record was removed or reordered',
      }
    }

    const recomputed = digest({
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload,
      source: event.source,
      prevHash: event.prevHash ?? GENESIS,
    })

    if (recomputed !== event.hash) {
      return {
        valid: false,
        checked: events.length,
        brokenAtId: event.id,
        reason: 'This entry’s contents no longer match its fingerprint — it was edited after the fact',
      }
    }
    expectedPrev = event.hash
  }

  return { valid: true, checked: events.length, head: expectedPrev }
}
