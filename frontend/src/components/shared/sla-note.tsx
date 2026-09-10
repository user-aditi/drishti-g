import { Info } from 'lucide-react'
import { SLA_DISCLOSURE } from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * Where a derived deadline came from, always within reach of the deadline.
 *
 * NYC publishes a `due_date` column and leaves it empty for every one of these
 * complaint types — all 355,430 rows. So there is no municipal promise to
 * report, and every hour figure in this system is our own statistic computed
 * from how long requests of that type actually took to close.
 *
 * Presenting that as a deadline without saying so would invent a commitment
 * the City never made, and attribute it to them. The rule this component
 * enforces: no screen shows an SLA figure or an overdue flag without the
 * derivation being reachable from the same place — a title on hover, and the
 * same text in a `<details>` for anyone who cannot hover.
 */
export function SlaNote({
    slaNote,
    className,
    label = 'How this deadline was derived',
}: {
    /** The type's own note. Falls back to the standing disclosure. */
    slaNote?: string | null
    className?: string
    label?: string
}) {
    const text = slaNote?.trim() ? slaNote : SLA_DISCLOSURE

    return (
        <details className={cn('group text-sm', className)}>
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-ink-soft hover:text-ink">
                <Info className="h-3.5 w-3.5" aria-hidden />
                <span className="underline decoration-dotted underline-offset-2">{label}</span>
            </summary>
            <p className="prose-measure mt-2 border-l-2 border-line-strong pl-3 text-sm text-ink-mid">
                {text}
            </p>
        </details>
    )
}

/**
 * The same fact, compressed to something that fits beside a number in a table
 * header. Carries the full text as a title so it is available on hover, and
 * the register's own footnote carries it in full for everyone else.
 */
export function SlaAsterisk({ slaNote }: { slaNote?: string | null }) {
    return (
        <abbr
            title={slaNote?.trim() ? slaNote : SLA_DISCLOSURE}
            className="cursor-help text-ink-soft no-underline"
        >
            <span aria-hidden>†</span>
            <span className="sr-only">derived deadline, not published by the City</span>
        </abbr>
    )
}

/** The footnote that has to sit under any register showing an overdue column. */
export function SlaFootnote({ className }: { className?: string }) {
    return (
        <p className={cn('prose-measure text-sm text-ink-soft', className)}>
            <span aria-hidden>† </span>
            {SLA_DISCLOSURE}
        </p>
    )
}
