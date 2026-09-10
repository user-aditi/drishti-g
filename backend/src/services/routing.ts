import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { badRequest } from '../utils/http.js'

/**
 * Where a newly filed request goes, and when it is due.
 *
 * This is deliberately the dullest possible router: the request type decides the
 * agency, because that is what NYC's own data says. In the Brooklyn slice the
 * mapping is perfectly determined — each of the six complaint types is handled
 * by exactly one agency across all 355,430 requests, with no overlap at all.
 *
 * That is worth stating plainly, because it sets a ceiling on what a routing
 * model can be shown to be worth here. A "modal agency per type" baseline scores
 * 100% on this slice, so there is nothing for a cleverer router to beat. Making
 * routing a real prediction problem needs complaint types that more than one
 * agency actually handles — NYC has plenty, Noise being the obvious one — and
 * that means widening the slice for that arm rather than pretending this one is
 * hard. Recorded so Phase 7 does not start on a false premise.
 *
 * The SLA is the type's, and it is derived rather than published: NYC gives no
 * `due_date` for any of these types. `RequestType.slaNote` carries the sentence
 * that has to travel with any figure computed from it.
 */

export interface Routed {
  agencyId: number
  slaDueAt: Date
  slaHours: number
  slaNote: string
}

const MS_PER_HOUR = 3_600_000

export async function routeRequest(
  db: Prisma.TransactionClient | typeof prisma,
  typeId: number,
  filedAt: Date,
): Promise<Routed> {
  const type = await db.requestType.findUnique({
    where: { id: typeId },
    select: { id: true, agencyId: true, slaHours: true, slaNote: true },
  })
  if (!type) throw badRequest('That request type does not exist')

  return {
    agencyId: type.agencyId,
    slaHours: type.slaHours,
    slaNote: type.slaNote,
    slaDueAt: new Date(filedAt.getTime() + type.slaHours * MS_PER_HOUR),
  }
}

/**
 * The next SR number for a request filed through this system.
 *
 * `DG-2026-000042`, distinct from the `NYC-` prefix imported rows carry. The
 * prefix is meant to be visible: a citizen looking up a number should be able to
 * tell a historical record of something New York did from something this system
 * did.
 *
 * The count is taken inside the caller's transaction so two simultaneous filings
 * cannot claim the same number; the unique constraint on `srNumber` is the
 * backstop if they ever do.
 */
export async function nextSrNumber(
  db: Prisma.TransactionClient,
  filedAt: Date,
): Promise<string> {
  const year = filedAt.getUTCFullYear()
  const prefix = `DG-${year}-`
  const latest = await db.serviceRequest.findFirst({
    where: { srNumber: { startsWith: prefix } },
    orderBy: { srNumber: 'desc' },
    select: { srNumber: true },
  })
  const sequence = latest ? Number(latest.srNumber.slice(prefix.length)) + 1 : 1
  return `${prefix}${String(sequence).padStart(6, '0')}`
}
