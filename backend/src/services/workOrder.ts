/**
 * Handing a job to somebody who has no account.
 *
 * Carried over from the NOIDA system, where it was designed for contractual
 * crews that rotate weekly, and the reasoning holds unchanged here: NYC 311
 * records no field worker any more than it records a case worker (F-12).
 * Modelling crews as users with passwords would be a fiction, and the first crew
 * change would break it. So a job is addressed by a code instead of an account —
 * printed, sent as a link, or shown as a QR — and the code is the whole
 * credential.
 */
import { randomInt } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

export type Db = PrismaClient | Prisma.TransactionClient

/**
 * Alphabet for job codes.
 *
 * No O/0, I/1/L, S/5 or B/8. These are read off a phone screen in daylight and
 * typed by someone who may be wearing gloves; every ambiguous pair removed is a
 * wrong code that never gets typed.
 */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789'

/**
 * How long a code stays usable, in real days.
 *
 * Wall-clock time, and deliberately so: this is not a question about NYC's
 * record, which is read against the system reference date, but about whether a
 * credential issued today should still open a job a month from now. It should
 * not.
 */
export const CODE_TTL_DAYS = 14

function randomCode(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)]!
  const block = () => Array.from({ length: 4 }, pick).join('')
  return `${block()}-${block()}`
}

/**
 * A code nobody else holds.
 *
 * Retries rather than trusting the odds: the space is large, but a collision
 * would hand one crew another's job, which is not a risk worth taking to save a
 * lookup.
 */
export async function generateCode(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const taken = await db.workOrder.findUnique({ where: { code }, select: { id: true } })
    if (!taken) return code
  }
  throw new Error('Could not allocate a unique work-order code')
}

/** Codes are typed by people: accept lower case and a missing dash. */
export function normaliseCode(input: string): string {
  const bare = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare
}

export type WorkOrderState = 'ISSUED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'

/** One state, derived, so "can this code still be used" has one answer. */
export function stateOf(
  order: { completedAt: Date | null; cancelledAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): WorkOrderState {
  if (order.completedAt) return 'COMPLETED'
  if (order.cancelledAt) return 'CANCELLED'
  if (order.expiresAt <= now) return 'EXPIRED'
  return 'ISSUED'
}

/**
 * The link a crew is sent, and what a QR encodes.
 *
 * Short and typeable, because the QR will not always scan and the fallback is
 * somebody reading eight characters aloud down a phone.
 */
export function workerLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/$/, '')}/w/${code}`
}
