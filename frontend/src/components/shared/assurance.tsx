import { ShieldCheck, ShieldQuestion, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { IdentityAssurance } from '@/types'

/**
 * How much the name on a piece of field work is worth.
 *
 * The people doing this work are contractual and rotate weekly, so there is no
 * account behind a submission — only the name the officer wrote on the slip.
 * Rather than pretend that is certainty or hide the doubt, every submission
 * carries a level and every level says plainly what it does and does not prove.
 *
 * Nothing here blocks anything. A worker standing over a finished job is never
 * turned away for arriving on a different phone; the officer inspecting the
 * work is simply told how much weight the attribution can bear.
 */
export const ASSURANCE_META: Record<
    IdentityAssurance,
    {
        label: string
        /** What an officer should actually conclude from it. */
        meaning: string
        variant: 'success' | 'info' | 'warning'
        icon: typeof ShieldCheck
    }
> = {
    OTP_VERIFIED: {
        label: 'Phone confirmed',
        meaning:
            'A one-time code was confirmed against the number on the crew roll, so this came from that person’s phone.',
        variant: 'success',
        icon: ShieldCheck,
    },
    DEVICE_BOUND: {
        label: 'Same phone',
        meaning:
            'Sent from the same phone that first opened the job code. It does not prove who was holding it, but the slip was not passed on.',
        variant: 'info',
        icon: Smartphone,
    },
    NONE: {
        label: 'Unverified',
        meaning:
            'Sent from a phone that did not open this code — typically a code read aloud. Judge this on the photographs alone.',
        variant: 'warning',
        icon: ShieldQuestion,
    },
}

/** The level, as one badge. */
export function AssuranceBadge({ level }: { level: IdentityAssurance }) {
    const meta = ASSURANCE_META[level]
    return (
        <Badge variant={meta.variant} title={meta.meaning}>
            <meta.icon className="h-3 w-3" aria-hidden />
            {meta.label}
        </Badge>
    )
}

/**
 * Who sent this, and how much that is worth — as one line above the evidence.
 *
 * The worker's own photograph sits here rather than beside the proof, because
 * it answers a different question and must never be mistaken for evidence that
 * the work was done.
 */
export function SubmittedBy({
    crewName,
    level,
    selfieUrl,
}: {
    crewName: string | null
    level: IdentityAssurance
    selfieUrl?: string | null
}) {
    const meta = ASSURANCE_META[level]

    return (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--sunken)] p-3">
            {selfieUrl ? (
                <a href={selfieUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={selfieUrl}
                        alt={crewName ? `Photograph sent by ${crewName}` : 'Photograph sent by the worker'}
                        className="h-14 w-14 rounded-full border border-[color:var(--border)] object-cover"
                    />
                </a>
            ) : (
                <span
                    aria-hidden
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[color:var(--muted)] text-[color:var(--subtle-foreground)]"
                >
                    <meta.icon className="h-6 w-6" />
                </span>
            )}

            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                        {crewName ?? 'Nobody named on the job'}
                    </span>
                    <AssuranceBadge level={level} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                    {meta.meaning}
                    {!selfieUrl && ' They did not send a photograph of themselves.'}
                </p>
            </div>
        </div>
    )
}
