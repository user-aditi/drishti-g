'use client'

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, TriangleAlert } from 'lucide-react'
import { WorkerShell } from './shell'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

/** How many characters a code carries, ignoring the dash. */
const CODE_LENGTH = 8

/**
 * Mirrors normaliseCode in the backend's workOrder service.
 *
 * Codes are typed by someone who may be wearing gloves, in sunlight, from
 * memory. Lower case, a missing dash and stray spaces all have to work, because
 * the alternative is a worker who cannot report finished work.
 */
function normalise(input: string): string {
    const bare = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
    return bare.length > 4 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare
}

export function CodeEntry() {
    const router = useRouter()
    const [code, setCode] = useState('')
    const [checking, setChecking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const bare = code.replace(/-/g, '')
    const complete = bare.length === CODE_LENGTH

    /**
     * Check the code before navigating.
     *
     * A wrong digit is the likeliest thing to go wrong here, so the answer
     * belongs on the screen the worker is already looking at, with the code
     * still in the box to be corrected — not on a job page that failed to load.
     */
    async function submit(e: FormEvent) {
        e.preventDefault()
        if (!complete || checking) return

        setChecking(true)
        setError(null)
        try {
            const res = await fetch(`${API}/work/${encodeURIComponent(code)}`)
            if (!res.ok) {
                const body = await res.json().catch(() => null)
                throw new Error(
                    body?.error ?? 'That code does not match any job. Check the digits and try again.',
                )
            }
            router.push(`/w/${code}`)
        } catch (err) {
            setError(
                err instanceof Error && err.message !== 'Failed to fetch'
                    ? err.message
                    : 'Could not reach the office. Check your signal and try again.',
            )
            setChecking(false)
            inputRef.current?.focus()
        }
    }

    return (
        <WorkerShell>
            <h1 className="text-xl font-bold">Open your job</h1>
            <p className="mt-1.5 text-base leading-relaxed text-[color:var(--muted-foreground)]">
                Type the code from your slip, or the one your officer read out to you.
            </p>

            <form onSubmit={submit} className="mt-5">
                <label htmlFor="code" className="block text-sm font-semibold">
                    Job code
                </label>

                <input
                    id="code"
                    ref={inputRef}
                    value={code}
                    onChange={(e) => {
                        setCode(normalise(e.target.value))
                        setError(null)
                    }}
                    // A cheap Android keyboard fights every one of these
                    // defaults unless it is told not to.
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                    enterKeyHint="go"
                    autoFocus
                    placeholder="ABCD-1234"
                    aria-describedby="code-help"
                    aria-invalid={error != null}
                    className="mt-2 w-full rounded-[var(--radius-xl)] border-2 border-[color:var(--input)] bg-[color:var(--card)] px-4 py-4 text-center font-mono text-3xl font-bold uppercase tracking-[0.2em] placeholder:tracking-[0.2em] placeholder:text-[color:var(--subtle-foreground)] focus-visible:border-[color:var(--primary)] focus-visible:outline-none"
                />

                <p id="code-help" className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                    Eight characters. Upper or lower case both work, and the dash is optional.
                </p>

                {error && (
                    <div
                        role="alert"
                        className="mt-4 flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color:var(--error-border)] bg-[color:var(--error-bg)] px-4 py-3 text-sm text-[color:var(--error-fg)]"
                    >
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>{error}</span>
                    </div>
                )}

                {/* Full width and tall: this is pressed with a thumb, often with
                    one hand, sometimes with a glove on. */}
                <button
                    type="submit"
                    disabled={!complete || checking}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-[var(--radius-xl)] bg-[color:var(--primary)] px-4 py-4 text-lg font-semibold text-[color:var(--primary-foreground)] transition-opacity disabled:opacity-40"
                >
                    {checking ? (
                        <>
                            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                            Opening…
                        </>
                    ) : (
                        <>
                            Open the job
                            <ArrowRight className="h-5 w-5" aria-hidden />
                        </>
                    )}
                </button>
            </form>

            <p className="mt-5 border-t border-[color:var(--border)] pt-4 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                Scanned a QR code instead? You do not need this page — it takes you straight to the
                job. If the code will not open, ring the officer who gave it to you and ask for a
                fresh one.
            </p>
        </WorkerShell>
    )
}
