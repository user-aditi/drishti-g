'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, Loader2, Printer, QrCode } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CardSkeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/shared/page-header'
import { TRADE_LABEL } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CrewRow, IssuedWorkOrder, Trade } from '@/types'

/**
 * Handing a job to somebody who has no account.
 *
 * This replaces the old "allot to a worker" step, which quietly assumed every
 * safai karamchari had a login. They do not, and pretending otherwise broke the
 * first time a contractor changed crew. The officer picks a name off their own
 * roll and the system produces a code — shown as a QR, sent as a link, or read
 * down a phone if both fail, which on a Noida street they often do.
 */
export function IssueWorkOrder({
    complaintId,
    preferredTrade,
    onIssued,
}: {
    complaintId: number
    preferredTrade: Trade | null
    onIssued: () => void
}) {
    const [crew, setCrew] = useState<CrewRow[]>([])
    const [loading, setLoading] = useState(true)
    const [selected, setSelected] = useState<number | null>(null)
    const [instructions, setInstructions] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [issued, setIssued] = useState<IssuedWorkOrder | null>(null)

    useEffect(() => {
        apiClient.crew
            .roll()
            .then((res) => {
                setCrew(res.items)
                // Prefer the right trade, then whoever is carrying least — which
                // is what an officer picks by default anyway.
                const matching = res.items.filter(
                    (c) => preferredTrade == null || c.trade === preferredTrade,
                )
                const pool = matching.length > 0 ? matching : res.items
                const lightest = [...pool].sort((a, b) => a.openJobs - b.openJobs)[0]
                setSelected(lightest?.id ?? null)
            })
            .catch(() => setError('Could not load your crew roll.'))
            .finally(() => setLoading(false))
    }, [preferredTrade])

    async function issue() {
        setSubmitting(true)
        setError(null)
        try {
            setIssued(await apiClient.crew.issue({ complaintId, crewId: selected, instructions }))
            onIssued()
        } catch (err) {
            setError(messageFrom(err, 'Could not issue this job.'))
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
        return (
            <div className="mt-3">
                <CardSkeleton rows={2} />
            </div>
        )
    }

    if (issued) return <IssuedSlip order={issued} />

    const exactTrade = preferredTrade != null && crew.some((c) => c.trade === preferredTrade)

    return (
        <div className="mt-4 space-y-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--muted)] p-4">
            {error && <ErrorBanner message={error} />}

            {crew.length === 0 ? (
                <div className="text-sm">
                    <p className="font-medium">Nobody is on your crew roll yet.</p>
                    <p className="mt-1 text-[color:var(--muted-foreground)]">
                        Add the people who actually work your sector, then you can hand them jobs.
                    </p>
                    <Button asChild size="sm" className="mt-3">
                        <Link href="/officer/crew">Set up my crew</Link>
                    </Button>
                </div>
            ) : (
                <>
                    <div>
                        <p className="text-sm font-medium">Who is doing this?</p>
                        {preferredTrade && !exactTrade && (
                            <p className="mt-0.5 text-xs text-[color:var(--warning-fg)]">
                                Nobody on your roll is a {TRADE_LABEL[preferredTrade]}. Showing
                                everyone — an imperfect match beats a job nobody is given.
                            </p>
                        )}

                        <div className="mt-2 space-y-1.5">
                            {crew.map((member) => {
                                const isChosen = selected === member.id
                                const rightTrade =
                                    preferredTrade == null || member.trade === preferredTrade
                                return (
                                    <button
                                        key={member.id}
                                        type="button"
                                        onClick={() => setSelected(member.id)}
                                        aria-pressed={isChosen}
                                        className={cn(
                                            'flex w-full items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors',
                                            isChosen
                                                ? 'border-[color:var(--primary)] bg-[color:var(--accent)]'
                                                : 'border-transparent bg-[color:var(--card)] hover:border-[color:var(--input)]',
                                        )}
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-medium">
                                                {member.fullName}
                                            </span>
                                            <span className="block text-xs text-[color:var(--muted-foreground)]">
                                                {TRADE_LABEL[member.trade]}
                                                {member.contractor && ` · via ${member.contractor.name}`}
                                            </span>
                                        </span>
                                        {!rightTrade && <Badge variant="warning">Other trade</Badge>}
                                        <span className="tnum shrink-0 text-xs text-[color:var(--muted-foreground)]">
                                            {member.openJobs === 0
                                                ? 'free'
                                                : `${member.openJobs} out`}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div>
                        <label
                            htmlFor={`instructions-${complaintId}`}
                            className="text-sm font-medium"
                        >
                            Anything they should know?{' '}
                            <span className="font-normal text-[color:var(--muted-foreground)]">
                                (optional)
                            </span>
                        </label>
                        <Textarea
                            id={`instructions-${complaintId}`}
                            rows={2}
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                            placeholder="e.g. Bin at the corner — clear the spill onto the footpath too"
                            className="mt-1"
                        />
                    </div>

                    <Button onClick={() => void issue()} disabled={submitting || selected == null}>
                        {submitting ? <Loader2 className="animate-spin" /> : <QrCode />}
                        Issue the job and get a code
                    </Button>
                </>
            )}
        </div>
    )
}

/**
 * The slip an officer holds up, prints, or forwards.
 *
 * All three routes to the worker are on screen at once because in the field any
 * one of them can fail: the QR will not scan on a cracked screen, the link is
 * useless without data, and the code is the fallback that always works because
 * it can be read aloud.
 */
export function IssuedSlip({ order }: { order: IssuedWorkOrder }) {
    const [copied, setCopied] = useState<'code' | 'link' | null>(null)

    async function copy(what: 'code' | 'link') {
        try {
            await navigator.clipboard.writeText(what === 'code' ? order.code : order.link)
            setCopied(what)
            setTimeout(() => setCopied(null), 2000)
        } catch {
            // Clipboard is blocked in plenty of browsers; the text is on screen
            // to be read either way, so this failing costs nothing.
        }
    }

    return (
        <div className="mt-4 rounded-lg border-2 border-[color:var(--primary)] bg-[color:var(--card)] p-4 print:border-black">
            <p className="text-sm font-semibold text-[color:var(--primary)]">
                Job issued{order.crew ? ` to ${order.crew.fullName}` : ''}
            </p>

            <div className="mt-3 flex flex-wrap items-start gap-5">
                <div className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={order.qrDataUrl}
                        alt={`QR code for job ${order.code}`}
                        className="h-40 w-40 rounded-lg border border-[color:var(--border)] bg-white"
                    />
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                            Or read them this code
                        </p>
                        {/* The code is the fallback that always works, but only
                            if the worker knows where to put it. Naming the page
                            is what makes reading it down a phone a real option
                            rather than a dead end. */}
                        <p className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                            They type it at{' '}
                            <span className="font-mono font-medium text-[color:var(--foreground)]">
                                {order.link.replace(/\/w\/.*$/, '/w')}
                            </span>
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                            <code className="rounded-lg bg-[color:var(--muted)] px-3 py-2 font-mono text-2xl font-bold tracking-widest">
                                {order.code}
                            </code>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void copy('code')}
                                className="print:hidden"
                            >
                                {copied === 'code' ? <Check /> : <Copy />}
                                {copied === 'code' ? 'Copied' : 'Copy'}
                            </Button>
                        </div>
                    </div>

                    <div className="print:hidden">
                        <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                            Or send them this link
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <code className="truncate rounded bg-[color:var(--muted)] px-2 py-1 text-xs">
                                {order.link}
                            </code>
                            <Button size="sm" variant="outline" onClick={() => void copy('link')}>
                                {copied === 'link' ? <Check /> : <Copy />}
                                {copied === 'link' ? 'Copied' : 'Copy'}
                            </Button>
                        </div>
                    </div>

                    <p className="text-xs text-[color:var(--muted-foreground)]">
                        Works until {formatDate(order.expiresAt)}. They do not need an account — the
                        code is the whole of it.
                    </p>

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.print()}
                        className="print:hidden"
                    >
                        <Printer />
                        Print the slip
                    </Button>
                </div>
            </div>
        </div>
    )
}
