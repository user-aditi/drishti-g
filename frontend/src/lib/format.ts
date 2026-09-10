/**
 * Formatting, fixed to the record's own clock.
 *
 * The dataset is a New York City record, so its dates read as New Yorkers wrote
 * them regardless of where the browser is: a request logged at 11pm on the 3rd
 * must not appear as the 4th because the reader is in another time zone. The row
 * is a municipal record with a date on it, not an event in the reader's day.
 *
 * The zone below is UTC, and that needs explaining, because the intent is New
 * York's clock rather than Greenwich's. NYC publishes `created_date` as a naive
 * local timestamp with no zone attached — `2022-01-01T00:11:06.000` — and the
 * importer stores exactly those digits, labelling them UTC so they survive the
 * round trip unchanged. The stored instant is therefore *already* New York's
 * wall clock; converting it again to `America/New_York` on the way out
 * subtracted the offset a second time and showed a request filed just after
 * midnight on 1 January as 31 December.
 *
 * So: render in UTC, and what appears on screen is character-for-character the
 * timestamp NYC published. The research harness parses the same CSV the same
 * naive way, which is what lets the database and the study agree to 0.000% on
 * every resolution-time percentile.
 */

const RECORD_ZONE = 'UTC'

const dateFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: RECORD_ZONE,
})

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: RECORD_ZONE,
})

/** The em dash stands in for "no value", everywhere, so a gap reads as a gap. */
export const EMPTY = '—'

export const formatDate = (iso: string | null | undefined): string =>
    iso ? dateFmt.format(new Date(iso)) : EMPTY

export const formatDateTime = (iso: string | null | undefined): string =>
    iso ? dateTimeFmt.format(new Date(iso)) : EMPTY

/** Plain integers with thousands separators, for counts in a column. */
export const formatCount = (value: number | null | undefined): string =>
    value == null ? EMPTY : new Intl.NumberFormat('en-US').format(value)

/**
 * A duration in the unit a reader can hold in their head.
 *
 * Median resolution comes back in hours and can be anything from two to nine
 * hundred, and "912 hours" is a number nobody converts. Days past a fortnight,
 * hours below it.
 */
export function formatHours(hours: number | null | undefined): string {
    if (hours == null || !Number.isFinite(hours)) return EMPTY
    if (hours < 1) return `${Math.round(hours * 60)} min`
    if (hours < 48) return `${hours.toFixed(1)} hrs`
    const days = hours / 24
    if (days < 14) return `${days.toFixed(1)} days`
    return `${Math.round(days)} days`
}

/**
 * "Now", as this system understands it.
 *
 * Not the wall clock. The corpus ends on 2025-12-31 and the API evaluates every
 * deadline against a configured reference date, so a screen that measured age
 * against the browser's clock would disagree with the `isOverdue` flag sitting
 * next to it — and would report every one of the 355,430 imported requests as
 * having waited since real time passed the end of the data.
 *
 * Callers that hold the reference date pass it. The fallback exists only so a
 * component still renders something sane if the clock could not be read.
 */
export const asOf = (referenceDate?: string | null): number =>
    referenceDate ? new Date(referenceDate).getTime() : Date.now()

/**
 * Relative time, in the direction the reader cares about.
 *
 * Deadlines read forward ("in 3 hours"), events read backward ("2 days ago").
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
    if (!iso) return EMPTY
    const diffMs = new Date(iso).getTime() - now
    const abs = Math.abs(diffMs)
    const ahead = diffMs > 0

    const minutes = Math.round(abs / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return ahead ? `in ${minutes}m` : `${minutes}m ago`

    const hours = Math.round(minutes / 60)
    if (hours < 24) return ahead ? `in ${hours}h` : `${hours}h ago`

    const days = Math.round(hours / 24)
    if (days < 60) return ahead ? `in ${days}d` : `${days}d ago`

    const months = Math.round(days / 30)
    if (months < 24) return ahead ? `in ${months}mo` : `${months}mo ago`

    return ahead ? `in ${Math.round(months / 12)}y` : `${Math.round(months / 12)}y ago`
}

/** How long a request has been open, or was open for, in hours. */
export function ageHours(createdAt: string, closedAt: string | null, now = Date.now()): number {
    const end = closedAt ? new Date(closedAt).getTime() : now
    return (end - new Date(createdAt).getTime()) / 3_600_000
}

export type DeadlineTone = 'stop' | 'wait' | 'neutral'

/**
 * A derived deadline, phrased as what is left of it.
 *
 * Note the wording: "past derived deadline", never "overdue by the City's
 * standard". The number is ours, and the phrase has to keep saying so even
 * when the footnote explaining it is two scrolls away.
 */
export function deadlineLabel(
    slaDueAt: string | null,
    stillOpen: boolean,
    now = Date.now(),
): { text: string; tone: DeadlineTone } {
    if (!slaDueAt) return { text: 'No derived deadline', tone: 'neutral' }

    const hoursLeft = (new Date(slaDueAt).getTime() - now) / 3_600_000

    if (!stillOpen) return { text: `Derived due ${formatDate(slaDueAt)}`, tone: 'neutral' }

    if (hoursLeft < 0) {
        const over = Math.abs(hoursLeft)
        const amount = over >= 48 ? `${Math.round(over / 24)}d` : `${Math.round(over)}h`
        return { text: `${amount} past derived deadline`, tone: 'stop' }
    }

    if (hoursLeft < 24) return { text: `${Math.round(hoursLeft)}h of derived time left`, tone: 'wait' }
    return { text: `${Math.round(hoursLeft / 24)}d of derived time left`, tone: 'wait' }
}

/**
 * Normalise whatever the reader typed into an SR number.
 *
 * People read these off a letter, a phone call or a screenshot, so they arrive
 * with spaces, hyphens and lowercase. Refusing them for that would be a lookup
 * box that only works for people who already have it on the clipboard.
 */
export function normaliseSrNumber(input: string): string {
    const bare = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')

    // Stripping the separators is only half the job: the stored numbers *have*
    // hyphens — `NYC-55983179` for an imported request and `DG-2026-000042` for
    // one filed here — so the canonical form has to be put back, or every lookup
    // of a correctly-typed number 404s.
    const imported = /^NYC(\d+)$/.exec(bare)
    if (imported) return `NYC-${imported[1]}`

    const filed = /^DG(\d{4})(\d+)$/.exec(bare)
    if (filed) return `DG-${filed[1]}-${filed[2]}`

    // Anything else is passed through as typed. The API answers 404 and the
    // lookup screen says so, which is a better outcome than this function
    // guessing at a shape it does not recognise.
    return bare
}

/** An ISO timestamp as the `yyyy-mm-dd` a date input expects. */
export const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')

/** "status_changed" -> "Status changed" */
export function humanise(value: string): string {
    const spaced = value.replace(/[._]/g, ' ').toLowerCase()
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
