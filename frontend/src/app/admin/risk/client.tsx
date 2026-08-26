'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CircleCheck, Compass, Landmark, Loader2, MapPin, Ruler } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorBanner, SectionHeading } from '@/components/shared/page-header'
import { RiskDial, RiskExplanation, RiskWorking } from '@/components/shared/risk-explanation'
import { formatDateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ReviewStatus, RiskDetail, RiskEntityType, RiskFlag } from '@/types'

const ENTITY_ICON: Record<RiskEntityType, typeof MapPin> = {
    SECTOR: MapPin,
    CIRCLE: Compass,
    ZONE: Landmark,
    DEPARTMENT: Landmark,
    CONTRACTOR: Building2,
    PROJECT: Ruler,
}

const REVIEW_ACTIONS: {
    status: ReviewStatus
    label: string
    hint: string
    variant: 'default' | 'outline'
}[] = [
    { status: 'ACKNOWLEDGED', label: 'Acknowledge', hint: 'Seen, monitoring it', variant: 'outline' },
    { status: 'ACTIONED', label: 'Action taken', hint: 'Something was done about it', variant: 'default' },
    { status: 'DISMISSED', label: 'Dismiss', hint: 'Not a real concern', variant: 'outline' },
]

const TABS: { key: ReviewStatus; label: string }[] = [
    { key: 'PENDING', label: 'Needs review' },
    { key: 'ACKNOWLEDGED', label: 'Acknowledged' },
    { key: 'ACTIONED', label: 'Actioned' },
    { key: 'DISMISSED', label: 'Dismissed' },
]

function FlagCard({ flag, onReviewed }: { flag: RiskFlag; onReviewed: () => void }) {
    const [expanded, setExpanded] = useState(false)
    const [detail, setDetail] = useState<RiskDetail | null>(null)
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState<ReviewStatus | null>(null)
    const [error, setError] = useState<string | null>(null)

    // The full working is only fetched when someone opens the card — the queue
    // itself already carries enough to triage.
    useEffect(() => {
        if (!expanded || detail) return
        apiClient
            .riskDetail(flag.entityType, flag.entityId)
            .then(setDetail)
            .catch(() => setDetail(null))
    }, [expanded, detail, flag.entityType, flag.entityId])

    async function review(status: ReviewStatus) {
        setBusy(status)
        setError(null)
        try {
            await apiClient.reviewFlag(flag.id, status, note || undefined)
            onReviewed()
        } catch (err) {
            setError(messageFrom(err, 'Could not record your decision.'))
        } finally {
            setBusy(null)
        }
    }

    const Icon = ENTITY_ICON[flag.entityType] ?? MapPin

    return (
        <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start gap-4 p-5">
                <RiskDial score={flag.score} band={flag.band} size={88} />

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                        <h3 className="truncate font-semibold">{flag.entityLabel}</h3>
                    </div>

                    <p className="mt-1.5 text-sm leading-relaxed">{flag.reason}</p>

                    <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                        Flagged {relativeTime(flag.createdAt)}
                        {flag.updatedAt !== flag.createdAt && ` · updated ${relativeTime(flag.updatedAt)}`}
                    </p>

                    <button
                        onClick={() => setExpanded((v) => !v)}
                        aria-expanded={expanded}
                        className="mt-3 text-sm font-medium text-[color:var(--primary)] hover:underline"
                    >
                        {expanded ? 'Hide the reasoning' : 'Why was this flagged?'}
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="space-y-5 border-t border-[color:var(--border)] bg-[color:var(--muted)]/60 p-5">
                    <div>
                        <SectionHeading title="Contributing factors" />
                        <RiskExplanation factors={flag.factors} score={flag.score} band={flag.band} />
                    </div>

                    {detail && (
                        <div>
                            <SectionHeading
                                title="The arithmetic"
                                description="Every number that produced this score, so you can check it yourself."
                            />
                            <RiskWorking factors={detail.factors} score={detail.score} />
                            <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
                                Model <span className="font-mono">{detail.modelVersion}</span> · computed{' '}
                                {formatDateTime(detail.computedAt)}
                            </p>
                        </div>
                    )}

                    <div className="border-t border-[color:var(--border)] pt-4">
                        <SectionHeading
                            title="Your decision"
                            description="Recorded in the audit trail against your name."
                        />

                        {error && <ErrorBanner message={error} />}

                        <Textarea
                            rows={2}
                            maxLength={2000}
                            className="mb-3"
                            placeholder="Optional note — what did you find, what did you do?"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />

                        <div className="flex flex-wrap gap-2">
                            {REVIEW_ACTIONS.map((action) => (
                                <Button
                                    key={action.status}
                                    size="sm"
                                    variant={action.variant}
                                    onClick={() => void review(action.status)}
                                    disabled={busy !== null}
                                    title={action.hint}
                                >
                                    {busy === action.status && <Loader2 className="animate-spin" />}
                                    {action.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </Card>
    )
}

export function RiskQueueClient({
    flags: initialFlags,
    threshold,
    canAct,
}: {
    flags: RiskFlag[]
    threshold: number
    canAct: boolean
}) {
    const router = useRouter()
    const [flags, setFlags] = useState(initialFlags)
    const [status, setStatus] = useState<ReviewStatus>('PENDING')
    const [loading, setLoading] = useState(false)
    const [recomputing, setRecomputing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => setFlags(initialFlags), [initialFlags])

    async function load(next: ReviewStatus) {
        setStatus(next)
        setLoading(true)
        try {
            const res = await apiClient.riskQueueByStatus(next)
            setFlags(res.items)
        } catch {
            setError('Could not load the risk queue.')
        } finally {
            setLoading(false)
        }
    }

    async function recompute() {
        setRecomputing(true)
        try {
            await apiClient.recomputeRisk()
            router.refresh()
            await load(status)
        } catch (err) {
            setError(messageFrom(err, 'Could not recompute scores.'))
        } finally {
            setRecomputing(false)
        }
    }

    return (
        <div>
            {canAct && (
                <div className="mb-5 flex justify-end">
                    <Button variant="outline" onClick={() => void recompute()} disabled={recomputing}>
                        {recomputing && <Loader2 className="animate-spin" />}
                        {recomputing ? 'Recomputing…' : 'Recompute scores'}
                    </Button>
                </div>
            )}

            {error && <ErrorBanner message={error} />}

            <div className="mb-5 flex flex-wrap gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-1">
                {TABS.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => void load(key)}
                        className={cn(
                            'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                            status === key
                                ? 'bg-[color:var(--primary)] text-white'
                                : 'text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <p className="text-sm text-[color:var(--muted-foreground)]">Loading…</p>
            ) : flags.length === 0 ? (
                <EmptyState
                    icon={<CircleCheck className="h-10 w-10" />}
                    title={status === 'PENDING' ? 'Nothing needs review' : 'Nothing here'}
                    description={
                        status === 'PENDING'
                            ? `Nothing is currently scoring ${threshold} or above.`
                            : 'No flags have reached this state yet.'
                    }
                />
            ) : (
                <div className="space-y-4">
                    {flags.map((flag) => (
                        <FlagCard key={flag.id} flag={flag} onReviewed={() => void load(status)} />
                    ))}
                </div>
            )}
        </div>
    )
}
