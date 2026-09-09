'use client'

import { useState } from 'react'
import { ShieldOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Panel, PanelHeader } from '@/components/shared/surface'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { formatDate } from '@/lib/format'
import type { AutonomyConsole, AutonomyQueueRow } from '@/types'

const RISK_TONE: Record<string, 'default' | 'purple' | 'neutral'> = {
    LOW: 'default',
    MEDIUM: 'purple',
    HIGH: 'neutral',
}

export function AutonomyClient({ data }: { data: AutonomyConsole }) {
    const [openId, setOpenId] = useState<string | number | null>(null)

    const columns: Column<AutonomyQueueRow>[] = [
        {
            key: 'complaint',
            header: 'Complaint',
            value: (r) => r.complaint.referenceNo,
            cell: (r) => (
                <RowTitle hint={r.complaint.referenceNo}>{r.complaint.title}</RowTitle>
            ),
        },
        {
            key: 'where',
            header: 'Held at',
            value: (r) => r.complaint.orgUnit?.name ?? '',
            cell: (r) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {r.complaint.orgUnit
                        ? `${r.complaint.orgUnit.kindLabel} ${r.complaint.orgUnit.name}`
                        : '—'}
                </span>
            ),
        },
        {
            key: 'expects',
            header: 'System expects',
            value: (r) => r.chosen,
            cell: (r) => <Mono>{r.chosen.toLowerCase().replaceAll('_', ' ')}</Mono>,
        },
        {
            key: 'confidence',
            header: 'Confidence',
            align: 'right',
            value: (r) => r.confidence ?? 0,
            cell: (r) => (
                <span className="tnum text-xs font-medium">
                    {r.confidence == null ? '—' : r.confidence.toFixed(2)}
                </span>
            ),
        },
        {
            key: 'filed',
            header: 'Filed',
            align: 'right',
            value: (r) => new Date(r.complaint.createdAt).getTime(),
            cell: (r) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {formatDate(r.complaint.createdAt)}
                </span>
            ),
        },
    ]

    return (
        <div className="space-y-5">
            {/*
             * The headline is a negative, so it says so first and plainly.
             * Burying "nothing is automated" under a chart of zeroes would be
             * the dishonest way to present this.
             */}
            <Panel className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <ShieldOff className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--muted-foreground)]" />
                    <div>
                        <h2 className="text-sm font-semibold">Nothing runs unattended</h2>
                        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                            Not as a precaution — as a measurement. Each threshold below was
                            chosen so the observed error among decisions it admits stays inside a
                            stated tolerance. For every class of action a person could take, no
                            confidence level met it. The system assesses{' '}
                            <span className="tnum font-semibold text-[color:var(--foreground)]">
                                {data.total.toLocaleString()}
                            </span>{' '}
                            open complaints and recommends every one of them to a human.
                        </p>
                    </div>
                </div>
                {data.spec && <Mono>{data.spec.modelVersion}</Mono>}
            </Panel>

            {data.spec && (
                <Panel flush>
                    <PanelHeader
                        title="What each threshold measured"
                        description="Derived from held-out cases, not chosen. A class is open only where the measured error stayed inside its tolerance."
                    />
                    <div className="divide-y divide-[color:var(--border)]">
                        {(['LOW', 'MEDIUM', 'HIGH'] as const).map((risk) => {
                            const rule = data.spec!.thresholds[risk]
                            if (!rule) return null
                            return (
                                <div key={risk} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                                    <Badge variant={RISK_TONE[risk]}>{risk}</Badge>
                                    <span className="tnum text-xs text-[color:var(--muted-foreground)]">
                                        tolerance {(rule.alpha * 100).toFixed(0)}%
                                    </span>
                                    <span className="tnum text-xs font-medium">
                                        {rule.automatable
                                            ? `threshold ${rule.threshold.toFixed(2)}`
                                            : 'no threshold works'}
                                    </span>
                                    {rule.automatable && (
                                        <span className="tnum text-xs text-[color:var(--muted-foreground)]">
                                            error {(rule.observedError * 100).toFixed(1)}% · covers{' '}
                                            {(rule.coverage * 100).toFixed(0)}%
                                        </span>
                                    )}
                                    <p className="w-full text-xs leading-relaxed text-[color:var(--subtle-foreground)]">
                                        {rule.why}
                                    </p>
                                </div>
                            )
                        })}
                    </div>
                </Panel>
            )}

            {data.byAction.length > 0 && (
                <Panel flush>
                    <PanelHeader
                        title="What the system expects to happen next"
                        description="Across every open complaint it could form a view on."
                    />
                    <div className="divide-y divide-[color:var(--border)]">
                        {data.byAction.map((row) => (
                            <div
                                key={row.action}
                                className="flex items-center justify-between gap-4 px-4 py-2.5"
                            >
                                <Mono>{row.action.toLowerCase().replaceAll('_', ' ')}</Mono>
                                <span className="tnum text-sm font-medium">
                                    {row.count.toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </Panel>
            )}

            <Panel flush>
                <PanelHeader
                    title="Review queue"
                    description="Least confident first — the opposite of every other register here, because the point is to surface what the system understands worst."
                />
                <DataTable
                    rows={data.queue}
                    columns={columns}
                    getRowId={(r) => r.id}
                    empty="Nothing has been assessed yet. The gate sweeps hourly."
                    hideCount
                    expansion={{
                        openId,
                        onToggle: setOpenId,
                        label: (r) => `Why ${r.complaint.referenceNo} was not automated`,
                        render: (r) => (
                            <div className="space-y-2">
                                <ul className="space-y-1.5 text-xs leading-relaxed">
                                    {r.reasons.map((reason, i) => (
                                        <li key={i} className="text-[color:var(--muted-foreground)]">
                                            {reason}
                                        </li>
                                    ))}
                                </ul>
                                {Array.isArray(r.feasibleSet) && r.feasibleSet.length > 0 && (
                                    <p className="text-[10px] text-[color:var(--subtle-foreground)]">
                                        Policy permitted:{' '}
                                        {r.feasibleSet
                                            .map((a) => String(a).toLowerCase().replaceAll('_', ' '))
                                            .join(', ')}
                                    </p>
                                )}
                            </div>
                        ),
                    }}
                />
            </Panel>
        </div>
    )
}
