import { Badge } from '@/components/ui/badge'
import { RANK_LABEL, STATUS_META } from '@/lib/constants'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { HistoryEntry } from '@/types'

/**
 * The complaint's journey, oldest first.
 *
 * This is the citizen-facing payoff of routing everything through GCCE: every
 * step, who took it, and why, in one readable column.
 */
export function Timeline({ history }: { history: HistoryEntry[] }) {
    if (history.length === 0) {
        return (
            <p className="text-sm text-[color:var(--muted-foreground)]">No activity recorded yet.</p>
        )
    }

    return (
        <ol className="relative space-y-6 pl-6">
            {/* The spine. Stops short of the last dot so it does not dangle. */}
            <span className="absolute bottom-3 left-[5px] top-2 w-px bg-[color:var(--border)]" aria-hidden />

            {history.map((entry) => {
                const meta = STATUS_META[entry.toStatus]
                const byGcce = entry.note?.startsWith('Routed by GCCE')
                const byEscalation = entry.note?.startsWith('Escalated from')

                return (
                    <li key={entry.id} className="relative">
                        <span
                            className={cn(
                                'absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[color:var(--card)]',
                                meta.dot,
                            )}
                            aria-hidden
                        />

                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold">
                                {byEscalation ? 'Escalated' : meta.label}
                            </span>
                            <time className="text-xs text-[color:var(--muted-foreground)]" dateTime={entry.createdAt}>
                                {formatDateTime(entry.createdAt)}
                            </time>
                        </div>

                        {entry.note && (
                            <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                                {entry.note}
                            </p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {byGcce ? (
                                <Badge variant="default">Decided by GCCE</Badge>
                            ) : byEscalation ? (
                                <Badge variant="purple">Escalation engine</Badge>
                            ) : (
                                entry.actor && (
                                    <span className="text-xs text-[color:var(--muted-foreground)]">
                                        {entry.actor.fullName}
                                        <span className="opacity-70"> · {RANK_LABEL[entry.actor.rank]}</span>
                                    </span>
                                )
                            )}
                        </div>

                        {entry.evidenceUrl && (
                            <a
                                href={entry.evidenceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2.5 block w-fit overflow-hidden rounded-lg border border-[color:var(--border)] transition-shadow hover:shadow-md"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={entry.evidenceUrl}
                                    alt="Evidence submitted by the field crew"
                                    className="h-32 w-auto object-cover"
                                    loading="lazy"
                                />
                                <span className="block bg-[color:var(--muted)] px-2 py-1 text-[11px] text-[color:var(--muted-foreground)]">
                                    Evidence photo — click to enlarge
                                </span>
                            </a>
                        )}
                    </li>
                )
            })}
        </ol>
    )
}
