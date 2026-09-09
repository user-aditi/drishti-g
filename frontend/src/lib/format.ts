const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
})

export const formatDate = (iso: string | null): string => (iso ? dateFmt.format(new Date(iso)) : '—')

export const formatDateTime = (iso: string | null): string =>
    iso ? dateTimeFmt.format(new Date(iso)) : '—'

/**
 * Relative time, in the direction the reader cares about.
 *
 * Deadlines read forward ("in 3 hours"), events read backward ("2 days ago").
 */
export function relativeTime(iso: string | null): string {
    if (!iso) return '—'
    const diffMs = new Date(iso).getTime() - Date.now()
    const abs = Math.abs(diffMs)
    const future = diffMs > 0

    const minutes = Math.round(abs / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`

    const hours = Math.round(minutes / 60)
    if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`

    const days = Math.round(hours / 24)
    if (days < 30) return future ? `in ${days}d` : `${days}d ago`

    const months = Math.round(days / 30)
    return future ? `in ${months}mo` : `${months}mo ago`
}

export type DeadlineTone = 'overdue' | 'urgent' | 'normal' | 'none'

/** Turn an SLA deadline into the phrase an officer actually needs. */
export function deadlineLabel(
    slaDueAt: string | null,
    stillOpen: boolean,
): { text: string; tone: DeadlineTone } {
    if (!slaDueAt) return { text: 'No deadline set', tone: 'none' }

    const hoursLeft = (new Date(slaDueAt).getTime() - Date.now()) / 3_600_000

    if (!stillOpen) return { text: `Due ${formatDate(slaDueAt)}`, tone: 'none' }
    if (hoursLeft < 0) {
        const overdueBy = Math.abs(Math.round(hoursLeft))
        return {
            text: overdueBy >= 24 ? `${Math.round(overdueBy / 24)}d overdue` : `${overdueBy}h overdue`,
            tone: 'overdue',
        }
    }
    if (hoursLeft < 12) return { text: `${Math.round(hoursLeft)}h left`, tone: 'urgent' }
    return { text: `${Math.round(hoursLeft / 24)}d left`, tone: 'normal' }
}

export const DEADLINE_TONE: Record<DeadlineTone, string> = {
    overdue: 'bg-[color:var(--error-bg)] text-[color:var(--error-fg)]',
    urgent: 'bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]',
    normal: 'bg-[color:var(--neutral-bg)] text-[color:var(--neutral-fg)]',
    none: 'bg-[color:var(--neutral-bg)] text-[color:var(--subtle-foreground)]',
}

/** "complaint.status_changed" -> "Status changed" */
export function humaniseAction(action: string): string {
    const tail = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action
    const spaced = tail.replace(/_/g, ' ')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export const initials = (name: string): string =>
    name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]!.toUpperCase())
        .join('')

/** Indian digit grouping, e.g. 4500000 -> "45,00,000". */
export const formatIndianNumber = (value: number): string =>
    new Intl.NumberFormat('en-IN').format(value)

/**
 * Rupees in the units a government budget is actually discussed in.
 *
 * A road contract is quoted in lakh and crore, not in eight digits — showing
 * "₹1,25,00,000" makes the reader count zeroes to compare two rows.
 */
export function formatRupees(value: number | null): string {
    if (value == null) return '—'
    if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`
    if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`
    return `₹${formatIndianNumber(Math.round(value))}`
}

/** An ISO timestamp as the `yyyy-mm-dd` a date input expects. */
export const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')
