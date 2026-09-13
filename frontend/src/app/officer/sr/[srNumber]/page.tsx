import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { WorkOrderPanel } from './work-orders'
import { LayerMark, StaffName } from '@/components/layer1/marks'
import { OfficerStatus } from '@/components/layer1/officer-status'
import { RequestDetail } from '@/components/request/request-detail'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { ApiError, messageFrom } from '@/lib/api-error'
import { homeFor, requireUser } from '@/lib/auth'
import { formatDateTime, normaliseSrNumber } from '@/lib/format'
import { getOfficerRequest } from '@/lib/layer1-server'
import { EscalationPanel } from '@/components/layer2/escalation-panel'
import { getRequestEscalations } from '@/lib/layer2-server'
import type { RequestEscalations } from '@/types/layer2'
import type { Layer1Detail } from '@/types/layer1'

export const dynamic = 'force-dynamic'

export function generateMetadata({ params }: { params: { srNumber: string } }): Metadata {
    return { title: `${normaliseSrNumber(decodeURIComponent(params.srNumber))} · Desk` }
}

/**
 * One request, as the person who answers for it works it.
 *
 * The record itself is the Layer 0 view, unchanged, because the officer and the
 * public are reading the same request and must not see two versions of it.
 * What Layer 1 adds sits in its own marked panel beside it: who is accountable,
 * since when, and the jobs sent to the street.
 *
 * Addressed by SR number, as every other request screen is — the build plan
 * wrote this route as `/officer/sr/[id]/work`, and it lives here instead so the
 * number a citizen holds opens the same request everywhere.
 */
export default async function OfficerRequestPage({ params }: { params: { srNumber: string } }) {
    const user = await requireUser()
    if (user.role !== 'OFFICER' && user.role !== 'SUPERVISOR') redirect(homeFor(user.role))

    const srNumber = normaliseSrNumber(decodeURIComponent(params.srNumber))
    let request: Layer1Detail
    try {
        request = await getOfficerRequest(srNumber)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        return (
            <PageShell>
                <ErrorNotice
                    title="Could not open this request"
                    message={messageFrom(err, 'The request could not be loaded.')}
                />
            </PageShell>
        )
    }

    // Layer 2's view of the same request. A failure here hides the panel rather
    // than the record: the request is still readable without its ladder.
    let escalations: RequestEscalations | null = null
    try {
        escalations = await getRequestEscalations(srNumber)
    } catch {
        escalations = null
    }

    const isHolder = user.role === 'OFFICER' && request.accountable?.id === user.id
    // Who may change the status: the officer who answers for it, or a supervisor
    // of its agency — the same rule the API enforces.
    const canChangeStatus = isHolder || user.role === 'SUPERVISOR'
    // The latest crew report, offered as the resolution note when closing.
    const crewNote =
        [...request.workOrders]
            .filter((order) => order.state === 'COMPLETED' && order.completionNote)
            .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0]?.completionNote ?? null
    const open = request.status !== 'CLOSED'

    return (
        <PageShell>
            <PageHeading title="Service request" description="The record, and who answers for it." />
            <RequestDetail
                request={request}
                referenceDate={new Date().toISOString()}
                actions={
                    <div className="flex flex-col gap-6">
                    <Panel>
                        <PanelHeader>
                            <PanelTitle>
                                <span className="inline-flex items-center gap-3">
                                    Accountability <LayerMark />
                                </span>
                            </PanelTitle>
                        </PanelHeader>
                        <PanelBody>
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1">
                                    <span className="label-cap">Answers for this request</span>
                                    {request.accountable ? (
                                        <StaffName
                                            name={request.accountable.name}
                                            isSynthetic={request.accountable.isSynthetic}
                                        />
                                    ) : (
                                        <span className="text-ink-soft">Nobody yet</span>
                                    )}
                                    {request.assignedAt && (
                                        <span className="text-sm text-ink-soft">
                                            Assigned by this system on{' '}
                                            <span className="mono">
                                                {formatDateTime(request.assignedAt)}
                                            </span>
                                            {request.isImported &&
                                                ' — long after New York filed it; NYC records no owner to carry over.'}
                                        </span>
                                    )}
                                </div>
                                <WorkOrderPanel
                                    requestId={request.id}
                                    workOrders={request.workOrders}
                                    canIssue={isHolder && open}
                                />
                            </div>
                        </PanelBody>
                    </Panel>
                    {canChangeStatus && (
                        <Panel>
                            <PanelHeader>
                                <PanelTitle>
                                    <span className="inline-flex items-center gap-3">
                                        Status <LayerMark />
                                    </span>
                                </PanelTitle>
                            </PanelHeader>
                            <PanelBody>
                                <OfficerStatus
                                    requestId={request.id}
                                    current={request.status}
                                    isImported={request.isImported}
                                    hasNote={Boolean(request.resolutionNote)}
                                    crewNote={crewNote}
                                />
                            </PanelBody>
                        </Panel>
                    )}
                    {escalations && <EscalationPanel data={escalations} />}
                    </div>
                }
            />
        </PageShell>
    )
}
