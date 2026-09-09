/**
 * Moving a simulated case back in time, after the API has already handled it.
 *
 * Why this exists
 * ---------------
 * The simulator's whole point is that GCCE really routes, the scheduler really
 * escalates and GRIE really scores — so every action goes through the HTTP API,
 * not through Prisma. But the API stamps `now()` on everything it writes, and a
 * log where six months of municipal work all happened this afternoon is useless
 * for the thing the log is for. Arrival bursts, response-time distributions and
 * SLA breaches are all statements about elapsed time.
 *
 * Two ways to get time spread. Inject a request-scoped clock into the API and
 * have every write consult it — which means threading a fake clock through the
 * routers, the services and the Prisma defaults, and leaving that seam in
 * production code forever. Or let the API behave exactly as it does in
 * production, and rewrite the timestamps afterwards. This is the second.
 *
 * The trade is stated plainly because it matters when reading any number
 * derived from this data: **the ordering and content of every row is real, and
 * the timestamps are not.** A row exists because the API decided to write it.
 * Its `createdAt` is fiction, assigned here.
 *
 * Safety
 * ------
 * This is the only part of the simulator that writes to the database directly,
 * and it writes nothing but timestamp columns. It refuses to run unless
 * `SIM_TIME_TRAVEL=1` is set, and refuses outright in production. Both guards
 * are deliberate: a function that silently rewrites history is exactly the
 * thing an audit trail exists to make impossible, and it must be impossible to
 * reach by accident.
 *
 * The audit hash chain is unaffected. `services/audit.ts` hashes action, actor,
 * entity, payload, source and the previous hash — never the timestamp — so
 * `verifyChain` still passes after a run. That is asserted at the end of every
 * simulation rather than assumed.
 */
import type { PrismaClient } from '@prisma/client'

export class TimeTravelForbidden extends Error {}

/**
 * Fail unless this run is explicitly allowed to rewrite timestamps.
 *
 * Called once at startup rather than per case, so a misconfigured run stops
 * before it has written anything.
 */
export function assertTimeTravelAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new TimeTravelForbidden(
      'The traffic simulator rewrites timestamps and must never run against production.',
    )
  }
  if (process.env.SIM_TIME_TRAVEL !== '1') {
    throw new TimeTravelForbidden(
      'Timestamp rewriting is off. Set SIM_TIME_TRAVEL=1 to allow it — see scripts/lib/sim-clock.ts for what it does.',
    )
  }
}

/** The simulated schedule for one case: which moment each of its rows belongs to. */
export interface CaseSchedule {
  complaintId: number
  filedAt: Date
  /** Simulated time for each status transition, in the order they were written. */
  transitions: Date[]
  slaDueAt: Date | null
  resolvedAt: Date | null
  closedAt: Date | null
  /** When the officer dispatched the crew, if they did. */
  issuedAt: Date | null
  /** When the crew reported the job done, if they did. */
  submittedAt: Date | null
}

/**
 * Rewrite one case's timeline onto its simulated schedule.
 *
 * Rows are matched to schedule entries by their own insertion order, which is
 * the order the API wrote them, so a case that took an unexpected path through
 * the lifecycle still gets a monotonically increasing timeline rather than a
 * mismatch. If the case produced more transitions than the schedule anticipated
 * — an escalation fired, say — the extra ones are spread between the last
 * scheduled moment and now.
 */
export async function reschedule(prisma: PrismaClient, schedule: CaseSchedule): Promise<void> {
  const history = await prisma.complaintStatusHistory.findMany({
    where: { complaintId: schedule.complaintId },
    orderBy: { id: 'asc' },
    select: { id: true },
  })

  const moments = fill(schedule.transitions, history.length, schedule.filedAt)
  const last = moments[moments.length - 1] ?? schedule.filedAt

  await prisma.$transaction([
    // Raw, because `updatedAt` is `@updatedAt` — Prisma overwrites it with
    // now() on any update through the client, which would leave every
    // backdated complaint claiming it was touched today.
    prisma.$executeRaw`
      UPDATE complaints
         SET "createdAt" = ${schedule.filedAt},
             "updatedAt" = ${last},
             "slaDueAt"  = ${schedule.slaDueAt},
             "resolvedAt" = ${schedule.resolvedAt},
             "closedAt"  = ${schedule.closedAt}
       WHERE id = ${schedule.complaintId}
    `,
    ...history.map((row, index) =>
      prisma.complaintStatusHistory.update({
        where: { id: row.id },
        data: { createdAt: moments[index] ?? schedule.filedAt },
      }),
    ),
    // The audit trail carries the same events; its hash covers action, actor,
    // entity, payload and the previous hash but never the timestamp, so moving
    // it keeps the trail readable and still verifiable.
    prisma.auditEvent.updateMany({
      where: { entityType: 'complaint', entityId: String(schedule.complaintId) },
      data: { createdAt: schedule.filedAt },
    }),
  ])

  // Work orders sit inside the case's timeline: issued when the officer
  // dispatched, submitted when the crew reported. Both are read straight off
  // the status history rather than guessed, so the job never appears to have
  // been done before it was ordered.
  const orders = await prisma.workOrder.findMany({
    where: { complaintId: schedule.complaintId },
    orderBy: { id: 'asc' },
    select: { id: true, submittedAt: true, closedAt: true },
  })
  if (orders.length === 0) return

  // Taken from the case's own named timeline rather than guessed by position:
  // a case that was refused once has two extra transitions, and counting them
  // off by index would date the job before the officer ordered it.
  const issued = schedule.issuedAt ?? last
  const submitted = schedule.submittedAt ?? issued

  for (const order of orders) {
    await prisma.workOrder.update({
      where: { id: order.id },
      data: {
        createdAt: issued,
        issuedAt: issued,
        ...(order.submittedAt ? { submittedAt: submitted } : {}),
        ...(order.closedAt ? { closedAt: schedule.resolvedAt ?? submitted } : {}),
      },
    })
  }
}

/**
 * Stretch or pad a list of moments to the required length.
 *
 * Short lists get extra moments interpolated after the last known one; long
 * lists are truncated. Either way the result is non-decreasing, because a
 * status history that goes backwards would be read by a process miner as a loop
 * that never happened.
 *
 * The padding is capped at the present. A case usually has more rows than the
 * plan anticipated because a sweep acted on it after the fact, and spacing
 * those six hours apart from the last planned moment walked the log days past
 * today — 56 rows in one run were dated in the future, which every consumer
 * downstream would have read as real. When there is no room left before now,
 * the extra rows are packed into whatever room remains instead.
 */
function fill(moments: Date[], length: number, fallback: Date): Date[] {
  if (length === 0) return []
  if (moments.length === 0) return Array.from({ length }, () => fallback)
  if (moments.length >= length) return moments.slice(0, length)

  const last = moments[moments.length - 1]!
  const extra = length - moments.length
  const ceiling = Date.now()
  const room = Math.max(ceiling - last.getTime(), 0)
  // Six hours apart where there is room for it, tighter where there is not.
  const step = Math.min(6 * 3_600_000, room / (extra + 1))

  return [
    ...moments,
    ...Array.from({ length: extra }, (_, i) =>
      new Date(Math.min(last.getTime() + (i + 1) * step, ceiling)),
    ),
  ]
}

/**
 * Move everything the scheduled sweeps wrote back onto the cases' own timelines.
 *
 * The sweeps run after all the traffic, by which time every case has already
 * been backdated — so they stamp real `now()` on work that belongs months
 * earlier. Left alone, the log shows a complaint filed in March being escalated
 * today, which is not a cosmetic problem: an escalation fires *because* a
 * deadline passed, so its date is the evidence for why it happened.
 *
 * Escalation writes three things per firing, and the first version of this
 * function moved only one of them. The `Escalation` row was rescheduled; the
 * `ComplaintStatusHistory` row recording the same event was not, so the event
 * log — the thing this whole wave exists to produce — kept the wrong date.
 *
 * Repeat firings are spaced rather than stacked. A complaint that climbed three
 * levels did so over three deadlines, not three times in the same instant, and
 * a process miner reading identical timestamps cannot order them at all.
 *
 * @param at  the moment a complaint first became overdue, or null if it is not
 *            one of ours — pre-existing overdue complaints keep their real
 *            timestamps, because they are not on any simulated timeline.
 */
export async function rescheduleSweepOutput(
  prisma: PrismaClient,
  watermarks: { escalationId: number; historyId: number },
  at: (complaintId: number) => Date | null,
): Promise<{ escalations: number; history: number }> {
  /** Successive firings for one case, spaced a day apart from the breach. */
  const spacing = new Map<number, number>()
  const nextMoment = (complaintId: number): Date | null => {
    const base = at(complaintId)
    if (!base) return null
    const nth = spacing.get(complaintId) ?? 0
    spacing.set(complaintId, nth + 1)
    return new Date(Math.min(base.getTime() + nth * 24 * 3_600_000, Date.now()))
  }

  const escalations = await prisma.escalation.findMany({
    where: { id: { gt: watermarks.escalationId } },
    orderBy: { id: 'asc' },
    select: { id: true, complaintId: true },
  })

  let movedEscalations = 0
  const perCase = new Map<number, Date[]>()

  for (const escalation of escalations) {
    const when = nextMoment(escalation.complaintId)
    if (!when) continue
    await prisma.escalation.update({ where: { id: escalation.id }, data: { createdAt: when } })
    movedEscalations++

    // Remember the moment so the matching history row gets the same one.
    const list = perCase.get(escalation.complaintId) ?? []
    list.push(when)
    perCase.set(escalation.complaintId, list)
  }

  // The history rows the sweep wrote, in the same order, matched per case.
  const history = await prisma.complaintStatusHistory.findMany({
    where: { id: { gt: watermarks.historyId } },
    orderBy: { id: 'asc' },
    select: { id: true, complaintId: true },
  })

  const taken = new Map<number, number>()
  const ceiling = Date.now()
  let movedHistory = 0

  for (const row of history) {
    const moments = perCase.get(row.complaintId)
    const index = taken.get(row.complaintId) ?? 0
    // A case can produce more history than escalations — the verification sweep
    // writes rows too. Anything past the escalations it knows about is pinned to
    // the last known moment rather than left sitting at today.
    const candidate = moments?.[index] ?? moments?.[moments.length - 1] ?? at(row.complaintId)
    if (!candidate) continue

    // Clamped, because a breach time is derived from an SLA deadline and a
    // complaint filed yesterday with a week-long deadline has one in the future.
    const when = new Date(Math.min(candidate.getTime(), ceiling))

    taken.set(row.complaintId, index + 1)
    await prisma.complaintStatusHistory.update({
      where: { id: row.id },
      data: { createdAt: when },
    })
    movedHistory++
  }

  return { escalations: movedEscalations, history: movedHistory }
}

/**
 * Put escalated complaints' deadlines back on the simulated timeline.
 *
 * `escalateComplaint` sets the next layer's deadline as `Date.now() + layerSLA`
 * — real now, because in production that is exactly right: the new officer gets
 * their full window starting when they receive the case.
 *
 * In a simulated run it is wrong in a way that quietly empties the register.
 * The sweeps execute after the traffic, so every one of the escalations lands a
 * deadline hours or days into the *real* future, unmoored from the case's own
 * history. The visible result is a register with 2,554 open complaints and
 * **zero** past their deadline — the officer desk shows no urgency, "sectors
 * needing attention" sorts by a column that is all zeros, and GRIE's SLA-breach
 * signal on open work reads nothing.
 *
 * This recomputes each escalated complaint's deadline as *its own escalation
 * moment plus the layer's allowance*, which is the same rule the service
 * applies, evaluated on the right clock. Cases escalated long ago in simulated
 * time then read as overdue, which is what a real register looks like.
 */
export async function repairEscalatedDeadlines(
  prisma: PrismaClient,
  slaHoursFor: (unitId: number, departmentId: number) => Promise<number | null>,
  since: number,
): Promise<{ repaired: number; nowOverdue: number }> {
  const escalations = await prisma.escalation.findMany({
    where: { id: { gt: since } },
    orderBy: { id: 'asc' },
    select: { complaintId: true, createdAt: true },
  })

  // Last escalation wins: that is the one that set the live deadline.
  const latest = new Map<number, Date>()
  for (const e of escalations) latest.set(e.complaintId, e.createdAt)

  let repaired = 0
  let nowOverdue = 0
  const now = Date.now()

  for (const [complaintId, at] of latest) {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      select: { orgUnitId: true, departmentId: true },
    })
    if (!complaint?.orgUnitId || !complaint.departmentId) continue

    const hours = await slaHoursFor(complaint.orgUnitId, complaint.departmentId)
    if (hours == null) continue

    const due = new Date(at.getTime() + hours * 3_600_000)
    await prisma.complaint.update({ where: { id: complaintId }, data: { slaDueAt: due } })
    repaired++
    if (due.getTime() < now) nowOverdue++
  }

  return { repaired, nowOverdue }
}
