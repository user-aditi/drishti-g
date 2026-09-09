/**
 * Handing a job to somebody who has no account.
 *
 * The chain of command in this system is real down to the Section Officer and
 * stops there, because that is where it stops in the authority too. Below the
 * Junior Engineer is contractual labour that rotates weekly; modelling each of
 * them as a departmental user with a password would be a fiction, and the first
 * crew change would break it.
 *
 * So a job is addressed by a code instead of an account. The officer issues it,
 * the worker opens it — from a printed slip, a QR on the officer's phone, or a
 * WhatsApp message — sends back what they did, and that is the whole of their
 * relationship with the platform.
 */
import { Prisma, WorkOrderStatus } from '@prisma/client'
import { randomInt } from 'node:crypto'

export type Db = Prisma.TransactionClient | import('@prisma/client').PrismaClient

/**
 * Alphabet for job codes.
 *
 * No O/0, I/1/L, S/5 or B/8. These are read off a phone screen in sunlight and
 * typed by someone who may be wearing gloves; every ambiguous pair removed is a
 * support call that never happens.
 */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789'

/** How long a code stays usable. Long enough for a week's work, not forever. */
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
 * would hand one worker another's job, which is not a risk worth taking for the
 * sake of skipping a lookup.
 */
export async function generateCode(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const taken = await db.workOrder.findUnique({ where: { code }, select: { id: true } })
    if (!taken) return code
  }
  throw new Error('Could not allocate a unique work-order code')
}

/** Codes are typed by humans: accept lower case and a missing dash. */
export function normaliseCode(input: string): string {
  const bare = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare
}

export const isOpenOrder = (status: WorkOrderStatus): boolean =>
  status === WorkOrderStatus.ISSUED || status === WorkOrderStatus.OPENED

/**
 * The link a worker is sent, and what a QR encodes.
 *
 * Deliberately short and typeable, because the QR will not always scan and the
 * fallback has to be somebody reading eight characters aloud down a phone.
 */
export function workerLink(publicUrl: string, code: string): string {
  return `${publicUrl.replace(/\/$/, '')}/w/${code}`
}
