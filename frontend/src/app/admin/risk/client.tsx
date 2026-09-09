'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, Compass, Landmark, Loader2, MapPin } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Panel } from '@/components/shared/surface'
import { Segmented, Toolbar } from '@/components/shared/controls'
import { DataTable, RowTitle, type Column } from '@/components/shared/data-table'
import { EmptyState, ErrorBanner, SectionHeading } from '@/components/shared/page-header'
import { RiskBadge } from '@/components/shared/status-badge'
import { RiskDial, RiskExplanation, RiskWorking } from '@/components/shared/risk-explanation'
import { formatDateTime, relativeTime } from '@/lib/format'
import type { ReviewStatus, RiskDetail, RiskEntityType, RiskFlag } from '@/types'

const ENTITY_ICON: Record<RiskEntityType, typeof MapPin> = {
    // One icon for every layer of the tree: a sector and the whole city are the
    // same kind of thing here, scored the same way.
    ORG_UNIT: MapPin,
    DEPARTMENT: Landmark,
    // Historical rows only.
    SECTOR: MapPin,
    CIRCLE: Compass,
    ZONE: Landmark,
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

const TABS: { value: ReviewStatus; label: string }[] = [
    { value: 'PENDING', label: 'Needs review' },
    { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
    { value: 'ACTIONED', label: 'Actioned' },
    { value: 'DISMISSED', label: 'Dismissed' },
]

/**
 * The reasoning behind one flag, and the decision it is waiting for.
 *
 * The full working is only fetched when someone opens the row — the queue
 * itself already carries enough to triage.
 */
function FlagReview({ flag, onReviewed }: { flag: RiskFlag; onReviewed: () => void }) {
    const [detail, setDetail] = useState<RiskDetail | null>(null)
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState<ReviewStatus | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        apiClient
            .riskDetail(flag.entityType, flag.entityId)
            .then(setDetail)
            .catch(() => setDetail(null))
    }, [flag.entityType, flag.entityId])

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

    return (
        <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
            <div className="flex justify-center lg:justify-start">
                <RiskDial score={flag.score} band={flag.band} size={104} />
            </div>

            <div className="min-w-0 space-y-5">
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
        </div>
    )
}

/**
 * The risk radar, as a queue.
 *
 * Each flag used to be a card carrying a dial, a paragraph and a hidden panel,
 * which meant four flags filled a screen and comparing scores meant scrolling.
 * A supervisor's actual question is "what is worst, and has anyone dealt with
 * it" — a sort down a score column. The dial and the full working still exist,
 * unchanged, in the row's expansion, where they are read one at a time anyway.
 */
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
    const [search, setSearch] = useState('')
    const [openId, setOpenId] = useState<string | number | null>(null)
    const [loading, setLoading] = useState(false)
    const [recomputing, setRecomputing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => setFlags(initialFlags), [initialFlags])

    async function load(next: ReviewStatus) {
        setStatus(next)
        setOpenId(null)
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

    const columns: Column<RiskFlag>[] = [
        {
            key: 'entity',
            header: 'What was flagged',
            value: (f) => f.entityLabel,
            cell: (f) => {
                const Icon = ENTITY_ICON[f.entityType] ?? MapPin
                return (
                    <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" aria-hidden />
                        <RowTitle>{f.entityLabel}</RowTitle>
                    </div>
                )
            },
        },
        {
            key: 'score',
            header: 'Score',
            align: 'right',
            width: 'w-32',
            value: (f) => f.score,
            cell: (f) => <RiskBadge band={f.band} score={f.score} />,
        },
        {
            key: 'reason',
            header: 'Why',
            value: (f) => f.reason,
            cell: (f) => (
                <p className="line-clamp-2 max-w-lg text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                    {f.reason}
                </p>
            ),
        },
        {
            key: 'flagged',
            header: 'Flagged',
            align: 'right',
            secondary: true,
            value: (f) => new Date(f.createdAt).getTime(),
            cell: (f) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {relativeTime(f.createdAt)}
                </span>
            ),
        },
    ]

    return (
        <div>
            {error && <ErrorBanner message={error} />}

            <Segmented
                label="Review state"
                value={status}
                onChange={(v) => void load(v)}
                options={TABS}
            />

            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search what has been flagged"
                actions={
                    canAct && (
                        <Button
                            variant="outline"
                            onClick={() => void recompute()}
                            disabled={recomputing}
                        >
                            {recomputing && <Loader2 className="animate-spin" />}
                            {recomputing ? 'Recomputing…' : 'Recompute scores'}
                        </Button>
                    )
                }
            />

            {loading ? (
                <Panel className="text-sm text-[color:var(--muted-foreground)]">Loading…</Panel>
            ) : flags.length === 0 ? (
                <EmptyState
                    icon={<CircleCheck className="h-6 w-6" />}
                    title={status === 'PENDING' ? 'Nothing needs review' : 'Nothing here'}
                    description={
                        status === 'PENDING'
                            ? `Nothing is currently scoring ${threshold} or above.`
                            : 'No flags have reached this state yet.'
                    }
                />
            ) : (
                <DataTable
                    rows={flags}
                    columns={columns}
                    getRowId={(f) => f.id}
                    search={search}
                    initialSort={{ key: 'score', direction: 'desc' }}
                    rowTone={(f) =>
                        f.band === 'SEVERE' ? 'danger' : f.band === 'HIGH' ? 'warning' : null
                    }
                    empty="No flags match that."
                    footnote={`Anything scoring ${threshold} or above is put in front of a human.`}
                    expansion={{
                        openId,
                        onToggle: setOpenId,
                        label: (f) => `Why ${f.entityLabel} was flagged`,
                        render: (f) => (
                            <FlagReview flag={f} onReviewed={() => void load(status)} />
                        ),
                    }}
                />
            )}
        </div>
    )
}
