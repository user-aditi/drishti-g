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
  /**
   * Who acted. `import` is the one that matters: an entry marked so records
   * that a row arrived from NYC Open Data, and never that this system did
   * anything to it. Keeping it distinct from `api` is what lets a reader tell
   * our actions from New York's history — the whole basis of the chain's value.
   */
  source?: 'api' | 'import' | 'system'
}

/**
 * Namespace for the append lock. Any constant works; it only has to be the same
 * one for every caller, and different from every other advisory lock the
 * application takes.
 */
const APPEND_LOCK = 8_314_502

/**
 * Append one event to the chain.
 *
 * Reading the head to get `prevHash` and then inserting after it is a
 * read-modify-write, and it used to be neither atomic nor protected. Two
 * overlapping writers both read the same newest row, both claimed it as their
 * predecessor, and the chain forked. On one simulated run of 1,600 complaints,
 * 410 hashes were claimed by more than one row and 485 entries failed the link
 * check — silently, because nothing throws when a chain stops being a chain.
 *
 * The concurrency is ordinary. Filing a complaint fires `scheduleUnitRescore()`
 * after the transaction commits, deliberately un-awaited, and three sweeps run
 * on timers inside the same process. Any of them overlapping a user request is
 * enough.
 *
 * `pg_advisory_xact_lock` serialises it. The lock is held until the surrounding
 * transaction ends and released automatically, including on rollback — which is
 * precisely why the read and the write must be *inside* a transaction. Taking
 * it on a bare client would acquire and release it within that one statement
 * and protect nothing, which is exactly what the first version of this fix did:
 * the tests still forked, and the unique index on `prevHash` caught it.
 *
 * So when the caller has not supplied a transaction, this opens one.
 */
export async function record(db: Db, input: RecordInput) {
  // A transaction client has no `$transaction` of its own, which is how we tell
  // "the caller is already inside one" from "we need to open one".
  if ('$transaction' in db) {
    return (db as PrismaClient).$transaction((tx) => append(tx, input))
  }
  return append(db, input)
}

/** The append itself. Always runs inside a transaction; see `record`. */
async function append(db: Prisma.TransactionClient, input: RecordInput) {
  // `$executeRaw`, not `$queryRaw`: the function returns void, and Prisma
  // cannot deserialise a void column.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${APPEND_LOCK}::bigint)`

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
