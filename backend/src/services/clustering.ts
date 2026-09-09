/**
 * Recognising that several people are reporting one problem.
 *
 * The failure this fixes is specific and common: twelve households ring in
 * about the same choked nala over four days, and the authority sees twelve
 * complaints, each looking like one household's minor grievance. Nobody sees
 * the nala. Each gets closed separately, or none of them do.
 *
 * Grouping them makes the size of the problem visible, and — because cluster
 * size feeds `priority.ts` — makes it *count*. It is deliberately distinct from
 * community support: support is people endorsing a grievance they know about,
 * this is people independently reporting the same thing without knowing about
 * each other, which is the commoner case and the one nobody can see unaided.
 *
 * The matching is token overlap, which is a baseline with a known ceiling. See
 * docs/advanced-capabilities.md §2 — sentence embeddings are the right tool and
 * would catch the pairs this misses.
 */
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { OPEN_STATUSES } from './gcce.js'
import { metresBetween, similarity } from './textSimilarity.js'

export type Db = PrismaClient | Prisma.TransactionClient

/**
 * How alike two reports must read before they are treated as one problem.
 *
 * Set where a false join is roughly as costly as a miss. Joining two genuinely
 * different complaints raises one citizen's priority on the strength of
 * somebody else's unrelated problem, which is unfair in a way a miss is not —
 * so the bar sits above the level where "road" and "sector" alone would clear
 * it, and an officer can always dismiss a cluster that got it wrong.
 */
const TEXT_THRESHOLD = 0.34

/** Reports further apart than this are separate problems, however alike. */
const MAX_METRES = 900

/** Beyond this, a new report is a recurrence rather than the same incident. */
const WINDOW_DAYS = 21

export interface ClusterMatch {
  clusterId: number
  size: number
  /** Why this was judged the same problem, for showing an officer. */
  reason: string
  sharedTerms: string[]
}

/**
 * Find the group a complaint belongs to, and put it there.
 *
 * Candidates are narrowed hard before any text comparison: same sector, same
 * category, still open, filed recently. That is what keeps this a handful of
 * string comparisons per filing rather than a scan of the register.
 */
export async function clusterComplaint(
  db: Db,
  complaintId: number,
): Promise<ClusterMatch | null> {
  const complaint = await db.complaint.findUnique({
    where: { id: complaintId },
    include: { category: true },
  })
  if (!complaint || complaint.sectorId == null || complaint.categoryId == null) return null

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)

  const candidates = await db.complaint.findMany({
    where: {
      id: { not: complaintId },
      sectorId: complaint.sectorId,
      categoryId: complaint.categoryId,
      status: { in: OPEN_STATUSES },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      title: true,
      description: true,
      latitude: true,
      longitude: true,
      clusterId: true,
      cluster: { select: { id: true, isDismissed: true, size: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })

  let best: { candidate: (typeof candidates)[number]; score: number; shared: string[] } | null = null

  for (const candidate of candidates) {
    if (candidate.cluster?.isDismissed) continue

    const { score, sharedTerms } = similarity(
      `${complaint.title} ${complaint.description}`,
      `${candidate.title} ${candidate.description}`,
    )
    if (score < TEXT_THRESHOLD) continue

    // Where both carry coordinates, they must actually be near each other.
    // Two genuine potholes at opposite ends of a sector are two potholes.
    if (
      complaint.latitude != null &&
      complaint.longitude != null &&
      candidate.latitude != null &&
      candidate.longitude != null
    ) {
      const metres = metresBetween(
        complaint.latitude,
        complaint.longitude,
        candidate.latitude,
        candidate.longitude,
      )
      if (metres > MAX_METRES) continue
    }

    if (!best || score > best.score) best = { candidate, score, shared: sharedTerms }
  }

  if (!best) return null

  const now = new Date()
  let clusterId = best.candidate.clusterId

  if (clusterId == null) {
    // The match is not in a group yet, so this pair becomes one. Named after
    // the earlier report, which is the one an officer will already have seen.
    const created = await db.grievanceCluster.create({
      data: {
        sectorId: complaint.sectorId,
        categoryId: complaint.categoryId,
        label: best.candidate.title,
        size: 2,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    })
    clusterId = created.id
    await db.complaint.update({
      where: { id: best.candidate.id },
      data: { clusterId },
    })
  } else {
    await db.grievanceCluster.update({
      where: { id: clusterId },
      data: { size: { increment: 1 }, lastSeenAt: now },
    })
  }

  await db.complaint.update({ where: { id: complaintId }, data: { clusterId } })

  const cluster = await db.grievanceCluster.findUniqueOrThrow({ where: { id: clusterId } })

  return {
    clusterId,
    size: cluster.size,
    reason:
      best.shared.length > 0
        ? `Reads like ${best.candidate.title} — both mention ${best.shared
            .slice(0, 4)
            .map((t) => `"${t}"`)
            .join(', ')}.`
        : `Reads like ${best.candidate.title}.`,
    sharedTerms: best.shared,
  }
}

/**
 * Take a complaint out of its group.
 *
 * For when an officer looks and decides these are not the same problem after
 * all. The group is dissolved rather than left at size one, because a cluster
 * of one is not a cluster and would keep showing on the desk as though it were.
 */
export async function unclusterComplaint(db: Db, complaintId: number): Promise<void> {
  const complaint = await db.complaint.findUnique({
    where: { id: complaintId },
    select: { clusterId: true },
  })
  if (!complaint?.clusterId) return

  await db.complaint.update({ where: { id: complaintId }, data: { clusterId: null } })

  const remaining = await db.complaint.count({ where: { clusterId: complaint.clusterId } })
  if (remaining <= 1) {
    await db.complaint.updateMany({
      where: { clusterId: complaint.clusterId },
      data: { clusterId: null },
    })
    await db.grievanceCluster.delete({ where: { id: complaint.clusterId } })
  } else {
    await db.grievanceCluster.update({
      where: { id: complaint.clusterId },
      data: { size: remaining },
    })
  }
}

/**
 * Group the whole open register in one pass.
 *
 * For backfilling an existing database, and for a periodic sweep — clustering
 * at filing time only compares against what already exists, so two complaints
 * arriving minutes apart can each find nothing and then never be reconsidered.
 */
export async function clusterOpenComplaints(db: PrismaClient): Promise<{
  examined: number
  grouped: number
  clusters: number
}> {
  const open = await db.complaint.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      clusterId: null,
      sectorId: { not: null },
      categoryId: { not: null },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })

  let grouped = 0
  for (const { id } of open) {
    const match = await clusterComplaint(db, id)
    if (match) grouped++
  }

  const clusters = await db.grievanceCluster.count()
  return { examined: open.length, grouped, clusters }
}
