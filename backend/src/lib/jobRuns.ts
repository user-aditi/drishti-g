/**
 * What the background jobs last did, for the people running the system.
 *
 * The sweeps log when they act and stay silent when they have nothing to do,
 * which is right for a log and useless for the question an operator actually
 * asks: is the sweep running at all? A sweep that died at boot and a sweep that
 * found nothing look identical in the log. This keeps the last run of each, in
 * memory — it describes this process, and a restart rightly starts it empty.
 */
export interface JobRun {
  name: string
  intervalMs: number
  registeredAt: Date
  runs: number
  failures: number
  lastStartedAt: Date | null
  lastFinishedAt: Date | null
  lastDurationMs: number | null
  lastResult: Record<string, number> | null
  lastError: string | null
}

const jobs = new Map<string, JobRun>()

export function registerJob(name: string, intervalMs: number): void {
  jobs.set(name, {
    name,
    intervalMs,
    registeredAt: new Date(),
    runs: 0,
    failures: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastResult: null,
    lastError: null,
  })
}

export function recordRun(
  name: string,
  startedAt: Date,
  outcome: { result: Record<string, number> } | { error: unknown },
): void {
  const job = jobs.get(name)
  if (!job) return
  const finishedAt = new Date()
  job.runs++
  job.lastStartedAt = startedAt
  job.lastFinishedAt = finishedAt
  job.lastDurationMs = finishedAt.getTime() - startedAt.getTime()
  if ('result' in outcome) {
    job.lastResult = outcome.result
    job.lastError = null
  } else {
    job.failures++
    job.lastError = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
  }
}

export function jobRuns(): JobRun[] {
  return [...jobs.values()]
}
