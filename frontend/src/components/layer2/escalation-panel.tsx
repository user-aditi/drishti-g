import { LayerMark, StaffName } from '@/components/layer1/marks'
import { Badge } from '@/components/ui/badge'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import type { RequestEscalations } from '@/types/layer2'
import { EscalateControl } from './escalate-control'

/**
 * How far up the ladder a request has gone, and how it got there.
 *
 * Layer 2 — NYC 311 has no escalation — so the whole panel carries the mark.
 * Each rung says what set it off: the sweep, finding the request past its derived
 * deadline, or a person, with the reason they gave. That sentence is all the
 * senior person it reached has to act on, so it is shown in full.
 */
export function EscalationPanel({ data }: { data: RequestEscalations }) {
    return (
        <Panel>
            <PanelHeader>
                <PanelTitle>
                    <span className="inline-flex items-center gap-3">
                        Escalation <LayerMark layer={2} />
                    </span>
                </PanelTitle>
            </PanelHeader>
            <PanelBody>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="label-cap">Now with</span>
                        {data.escalationLevel === 0 ? (
                            <span className="text-ink-mid">Its officer alone</span>
                        ) : (
                            <Badge tone="new">Escalated · {data.escalationLevelName}</Badge>
                        )}
                    </div>

                    {data.escalations.length > 0 && (
                        <ol className="flex flex-col divide-y divide-line rounded-[var(--radius)] border border-line">
                            {data.escalations.map((rung) => (
                                <li key={rung.id} className="flex flex-col gap-1 px-3 py-2">
                                    <span className="text-sm text-ink">
                                        To the {rung.toLevelName}
                                        {rung.toUser ? (
                                            <>
                                                {' — '}
                                                <StaffName name={rung.toUser.name} isSynthetic={rung.toUser.isSynthetic} />
                                            </>
                                        ) : (
                                            ' — nobody holds this rung in the agency'
                                        )}
                                    </span>
                                    <span className="text-sm text-ink-mid">
                                        {rung.trigger === 'SLA_BREACH' ? (
                                            <>
                                                Automatic: {rung.reason.toLowerCase()}
                                                <span aria-hidden> †</span>
                                            </>
                                        ) : (
                                            <>
                                                Raised by {rung.raisedBy?.name ?? 'someone'}: &ldquo;{rung.reason}&rdquo;
                                            </>
                                        )}
                                    </span>
                                    <span className="mono text-sm text-ink-soft">{formatDateTime(rung.at)}</span>
                                </li>
                            ))}
                        </ol>
                    )}

                    {data.canEscalate && data.nextLevelName && (
                        <EscalateControl requestId={data.requestId} nextLevelName={data.nextLevelName} />
                    )}
                </div>
            </PanelBody>
        </Panel>
    )
}
