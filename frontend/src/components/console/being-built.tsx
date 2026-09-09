import type { ReactNode } from 'react'

/**
 * The honest empty state.
 *
 * Some parts of this system have their structure built but no real data behind
 * them yet. The temptation is to fill them with seed rows and let the screen
 * imply a completeness it does not have — which is exactly how a demo starts
 * lying. This panel says what will be here, what it is waiting on, and what
 * already works, so nobody mistakes scaffolding for a finished feature.
 *
 * Every entry is tracked in docs/pending-work.md.
 */
export function BeingBuilt({
    title,
    what,
    waitingOn,
    working,
}: {
    /** What this area will be, in one line. */
    title: string
    what: ReactNode
    /** The specific thing that has to exist before it can be real. */
    waitingOn: ReactNode
    /** What already runs, so the panel is not read as "nothing here". */
    working?: ReactNode
}) {
    return (
        <section className="rounded-xl border border-dashed border-[color:var(--input)] bg-[color:var(--card)] px-5 py-6">
            <div className="flex flex-wrap items-center gap-2">
                <span
                    aria-hidden
                    className="rounded-full bg-[color:var(--warning-bg)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--warning-fg)]"
                >
                    Being built
                </span>
                <h2 className="text-sm font-semibold">{title}</h2>
            </div>

            <dl className="mt-4 space-y-3 text-sm">
                <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                        What will be here
                    </dt>
                    <dd className="mt-1 leading-relaxed">{what}</dd>
                </div>
                <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                        Waiting on
                    </dt>
                    <dd className="mt-1 leading-relaxed">{waitingOn}</dd>
                </div>
                {working && (
                    <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                            Already working
                        </dt>
                        <dd className="mt-1 leading-relaxed">{working}</dd>
                    </div>
                )}
            </dl>
        </section>
    )
}
