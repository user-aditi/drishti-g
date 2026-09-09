/**
 * The work nobody triggers.
 *
 * Three things in this system happen because time passed rather than because
 * somebody clicked: a complaint breaches its deadline and climbs the chain, a
 * resident never answers and the job has to be decided without them, and two
 * near-identical reports that arrived minutes apart need reconsidering as a
 * pair. Without a timer, all three are theory.
 *
 * Deliberately an in-process interval rather than a job queue. A single API
 * process is what this deployment is, and adding Redis and a worker fleet to
 * run three functions every few minutes would be infrastructure for its own
 * sake. The trade is stated plainly below, so the point at which it stops being
 * the right call is recognisable rather than surprising.
 */
import { prisma } from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { clusterOpenComplaints } from './clustering.js'
import { runEscalationSweep } from './escalation.js'
import { applyPriority } from './priority.js'
import { OPEN_STATUSES } from './gcce.js'
import { sweepSilentCitizens } from './verification.js'

const log = createLogger('scheduler')

interface Job {
  name: string
  everyMinutes: number
  run: () => Promise<unknown>
}

const JOBS: Job[] = [
  {
    name: 'escalation',
    everyMinutes: 15,
    run: runEscalationSweep,
  },
  {
    name: 'verification',
    everyMinutes: 30,
    run: () => sweepSilentCitizens(prisma),
  },
  {
    // Least urgent of the three: a complaint joining a group changes its
    // priority, not whether anyone is working on it.
    name: 'clustering',
    everyMinutes: 60,
    run: async () => {
      const result = await clusterOpenComplaints(prisma)
      if (result.grouped === 0) return result

      // Grouping changes how many households a complaint affects, so anything
      // newly grouped has to be rescored or the number goes stale.
      const grouped = await prisma.complaint.findMany({
        where: { clusterId: { not: null }, status: { in: OPEN_STATUSES } },
        select: { id: true },
      })
      for (const c of grouped) await applyPriority(prisma, c.id)
      return { ...result, rescored: grouped.length }
    },
  },
  {
    // The autonomy gate, which advises and never acts. Least urgent of all: it
    // changes nothing about a complaint, it only records what the system would
    // have done and how sure it was. Hourly is often enough for a queue an
    // officer reads, and keeping it out of the request path means a slow model
    // can never delay a citizen filing.
    name: 'autonomy',
    everyMinutes: 60,
    run: async () => {
      const { sweepAutonomy } = await import('./autonomy.js')
      return sweepAutonomy(prisma)
    },
  },
]

const timers: NodeJS.Timeout[] = []

/**
 * Guard against a slow run overlapping its own next tick.
 *
 * The clustering sweep walks the open register; on a bad day that could take
 * longer than its interval, and two of them running at once would fight over
 * the same rows.
 */
const running = new Set<string>()

async function runJob(job: Job) {
  if (running.has(job.name)) {
    log.warn(`${job.name} sweep still running, skipping this tick`)
    return
  }
  running.add(job.name)
  const started = Date.now()
  try {
    const result = await job.run()
    log.info(`${job.name} sweep finished in ${Date.now() - started}ms`, result)
  } catch (err) {
    // A failing sweep must never take the API process with it.
    log.error(`${job.name} sweep failed`, err)
  } finally {
    running.delete(job.name)
  }
}

/**
 * Start the timers.
 *
 * Nothing runs at boot: a process restarting in a loop would otherwise hammer
 * the database, and none of these are urgent enough to justify the risk. The
 * first tick of each is one interval away.
 */
export function startScheduler(): void {
  if (timers.length > 0) return

  for (const job of JOBS) {
    const interval = job.everyMinutes * 60_000
    const timer = setInterval(() => void runJob(job), interval)
    // Do not hold the process open for the sake of a timer.
    timer.unref()
    timers.push(timer)
    log.info(`${job.name} sweep scheduled every ${job.everyMinutes}m`)
  }
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer)
  timers.length = 0
}
