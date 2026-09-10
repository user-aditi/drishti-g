/**
 * The date this system evaluates "now" against.
 *
 * The corpus is real NYC 311 data that ends on 2025-12-31, and every request in
 * it was filed before that. Wall-clock time is somewhere after it. So anything
 * that asks "is this overdue?" of `Date.now()` answers yes for all 355,430 rows,
 * every queue sorts identically, and every breach figure reads 100% — a bug that
 * looks exactly like a working feature, which is why it survived once already
 * (F-04).
 *
 * The fix is to move the clock, not the data. Time-shifting imported timestamps
 * so they land near today would make the wall-clock version appear to work while
 * destroying the seasonality underneath: garbage complaints genuinely spike in
 * summer and streetlight complaints in winter, and those cycles are what the
 * risk signals are built from. The dates stay real; the observer stands at the
 * end of the corpus.
 *
 * This module deliberately reads `process.env` directly rather than importing
 * `env.ts`. The reference date is needed by the importer and by scripts that run
 * without a JWT secret or an API to serve, and `env.ts` exits the process when
 * those are missing.
 */

/**
 * The last `created_date` in `research/data/nyc/brooklyn.csv`, measured rather
 * than assumed. Standing here means the newest request in the corpus is one
 * minute old and the oldest is four years old, which is what a real console on
 * this data would show.
 */
export const CORPUS_LAST_CREATED_AT = '2025-12-31T23:11:00.000Z'

/**
 * Where the system believes it is standing in time.
 *
 * Read on every call rather than cached at import: a test that wants to see a
 * queue from a different vantage point sets the variable and expects to be
 * believed.
 */
export function referenceDate(): Date {
  const raw = process.env.SYSTEM_REFERENCE_DATE?.trim()
  const value = new Date(raw && raw.length > 0 ? raw : CORPUS_LAST_CREATED_AT)

  // A typo here would silently produce Invalid Date, and every comparison
  // against it is false — no error, just a system where nothing is ever overdue.
  if (Number.isNaN(value.getTime())) {
    throw new Error(
      `SYSTEM_REFERENCE_DATE is not a date: ${JSON.stringify(raw)}. ` +
        'Use an ISO-8601 instant, e.g. 2025-12-31T23:11:00.000Z.',
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
