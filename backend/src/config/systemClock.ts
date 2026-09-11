/**
 * The date this system evaluates "now" against.
 *
 * Not the wall clock, and — after a correction worth recording — not the last
 * day of the corpus either.
 *
 * The first version stood at the last `created_date` in the slice, 2025-12-31,
 * on the reasoning that that is where the data ends. It is where the *intake*
 * ends. The statuses and closure times are a snapshot taken when the corpus was
 * pulled, on 2026-09-09, and NYC kept working the backlog in between: 6,628 of
 * the imported requests were closed after 31 December. Standing at 31 December
 * therefore showed those requests as Closed "as at" a date on which they were
 * still open — a banner claiming a date the record does not describe (F-28).
 *
 * The only moment at which every field of every row is simultaneously true is
 * the moment it was observed, so that is where the observer stands. The value is
 * the `pulled_at` in `research/data/nyc/brooklyn.meta.json`, copied rather than
 * read at runtime because the API container does not mount the research tree;
 * `npm run verify:import` fails if the two ever drift, which is what a re-pull
 * without updating this constant would otherwise do silently.
 *
 * What does not change is the rule behind all of this: move the clock, never the
 * data. Time-shifting the imported timestamps would make the wall clock appear
 * to work while destroying the seasonality underneath — garbage complaints
 * genuinely spike in summer — and that seasonality is what the risk signals are
 * built from.
 *
 * One consequence to state plainly rather than discover: at the snapshot date
 * essentially every still-open imported request is overdue, because the slice's
 * newest request was filed eight months earlier against deadlines of ten days or
 * less. That is the true state of a historical backlog, not a symptom of the
 * clock being wrong, and it means "overdue" cannot distinguish a working clock
 * from a broken one on this corpus. The mechanism is pinned by tests instead.
 *
 * This module reads `process.env` directly rather than importing `env.ts`: the
 * importer and verification scripts use it without a JWT secret or an API to
 * serve, and `env.ts` exits the process when those are missing.
 */

/**
 * When NYC's statuses and closure times were observed: the corpus pull.
 * Must equal `pulled_at` in `research/data/nyc/brooklyn.meta.json`.
 */
export const CORPUS_SNAPSHOT_AT = '2026-09-09T22:34:59.000Z'

/**
 * Where the system believes it is standing in time.
 *
 * Read on every call rather than cached at import: a test that wants to see a
 * queue from a different vantage point sets the variable and expects to be
 * believed.
 */
export function referenceDate(): Date {
  const raw = process.env.SYSTEM_REFERENCE_DATE?.trim()
  const value = new Date(raw && raw.length > 0 ? raw : CORPUS_SNAPSHOT_AT)

  // A typo here would silently produce Invalid Date, and every comparison
  // against it is false — no error, just a system where nothing is ever overdue.
  if (Number.isNaN(value.getTime())) {
    throw new Error(
      `SYSTEM_REFERENCE_DATE is not a date: ${JSON.stringify(raw)}. ` +
        'Use an ISO-8601 instant, e.g. 2026-09-09T22:34:59.000Z.',
    )
  }
  return value
}

/**
 * Overdue is a comparison, never a stored column, and never against wall-clock
 * time. Anything that reports a breach goes through here.
 */
export function isOverdue(slaDueAt: Date | null | undefined, now: Date = referenceDate()): boolean {
  return slaDueAt != null && slaDueAt.getTime() < now.getTime()
}
