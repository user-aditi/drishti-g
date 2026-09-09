import type { ReactNode } from 'react'

/**
 * The chrome for the street worker's two screens.
 *
 * Sits outside every layout in the app — no sidebar, no nav, no session. A
 * worker arrives, does one thing, and leaves; anything else on the screen is in
 * their way.
 *
 * Pinned to the light palette with `force-light`. This is read one-handed in
 * bright sun on a cheap Android, where the dark theme is genuinely harder to
 * see, and the phone's own night setting should not make that decision for
 * somebody standing over an open drain.
 */
export function WorkerShell({ children }: { children: ReactNode }) {
    return (
        <div className="force-light min-h-screen bg-[color:var(--muted)] py-4 text-[color:var(--foreground)]">
            <div className="mx-auto w-full max-w-md px-4">
                <div className="mb-4 flex items-center gap-2">
                    <span
                        aria-hidden
                        className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-lg)] bg-[color:var(--primary)] text-xs font-bold text-[color:var(--primary-foreground)]"
                    >
                        दृ
                    </span>
                    <span className="text-sm font-bold">DRISHTI-G</span>
                    <span className="text-sm text-[color:var(--muted-foreground)]">
                        · NOIDA Authority
                    </span>
                </div>
                <div className="rounded-[var(--radius-2xl)] bg-[color:var(--card)] p-5 shadow-[var(--shadow-sm)]">
                    {children}
                </div>
            </div>
        </div>
    )
}
