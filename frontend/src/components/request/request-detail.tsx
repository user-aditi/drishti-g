import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { Field } from '@/components/shared/page-heading'
import { SlaNote } from '@/components/shared/sla-note'
import { ReferenceDateInline } from '@/components/shared/reference-date'
import { OverdueMark, ProvenanceMark, SrNumber, StatusPill } from '@/components/shared/request-bits'
import { RequestTimeline } from './request-timeline'
import { CHANNEL_LABEL } from '@/lib/constants'
import { EMPTY, ageHours, asOf, deadlineLabel, formatDateTime, formatHours } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RequestDetail as RequestDetailShape } from '@/types'

/**
 * One service request, in full.
 *
 * Shared by the public status page and the agent's working view, because they
 * should not disagree. An agent gets actions the public does not, but the
 * record itself is the same record — if the two views described it differently,
 * one of them would be wrong and nobody would know which.
 */
export function RequestDetail({
    request,
    referenceDate,
    actions,
}: {
    request: RequestDetailShape
    /** The day the API evaluated `isOverdue` on. Everything here uses it. */
    referenceDate: string
    /** Status controls, on the agent's view only. */
    actions?: React.ReactNode
}) {
    const now = asOf(referenceDate)
    const stillOpen = request.status !== 'CLOSED'
    const overdue = request.isOverdue && stillOpen
    const deadline = deadlineLabel(request.slaDueAt, stillOpen, now)

    return (
        <div className="flex flex-col gap-6">
            <Panel>
                <PanelHeader>
                    <div className="flex flex-col gap-1">
                        <span className="label-cap">Service request</span>
                        <SrNumber
                            value={request.srNumber}
                            className="text-xl font-semibold text-ink"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={request.status} />
                        {overdue && <OverdueMark />}
                        <ProvenanceMark isImported={request.isImported} />
                    </div>
                </PanelHeader>

                <PanelBody className="flex flex-col gap-4">
                    <div>
                        <h2 className="text-xl font-semibold text-ink">
                            {request.type?.name ?? 'Complaint type not recorded'}
                        </h2>
                        {request.descriptor && (
                            <p className="text-base text-ink-mid">{request.descriptor.name}</p>
                        )}
                    </div>

                    <dl className="flex flex-col">
                        <Field label="Handled by">
                            {request.agency ? (
                                <>
                                    {request.agency.name}{' '}
                                    <span className="mono text-sm text-ink-soft">
                                        ({request.agency.code})
                                    </span>
                                </>
                            ) : (
                                EMPTY
                            )}
                        </Field>
                        <Field label="Community board">
                            {request.orgUnit ? (
                                <>
                                    {request.orgUnit.name}{' '}
                                    <span className="mono text-sm text-ink-soft">
                                        ({request.orgUnit.code})
                                    </span>
                                </>
                            ) : (
                                EMPTY
                            )}
                        </Field>
                        <Field label="Address">{request.address ?? EMPTY}</Field>
                        <Field label="ZIP" mono>
                            {request.zip ?? EMPTY}
                        </Field>
                        <Field label="Council district" mono>
                            {request.councilDistrict ?? EMPTY}
                        </Field>
                        <Field label="Police precinct" mono>
                            {request.policePrecinct ?? EMPTY}
                        </Field>
                        <Field label="Reported via">{CHANNEL_LABEL[request.channel]}</Field>
                        <Field label="Filed" mono>
                            {formatDateTime(request.createdAt)}
                        </Field>
                        <Field label="Closed" mono>
                            {request.closedAt ? formatDateTime(request.closedAt) : EMPTY}
                        </Field>
                        <Field label={stillOpen ? 'Open for' : 'Time to close'} mono>
                            {formatHours(ageHours(request.createdAt, request.closedAt, now))}
                        </Field>
                        <Field label="Derived deadline †">
                            <span
                                className={cn(
                                    'mono text-sm',
                                    deadline.tone === 'stop' && 'text-stop',
                                    deadline.tone === 'wait' && 'text-wait',
                                )}
                            >
                                {request.slaDueAt ? formatDateTime(request.slaDueAt) : EMPTY}
                            </span>
                            <span className="ml-2 text-sm text-ink-soft">{deadline.text}</span>
                            {stillOpen && (
                                <span className="ml-2">
                                    <ReferenceDateInline referenceDate={referenceDate} />
                                </span>
                            )}
                        </Field>
                    </dl>

                    {/* The derivation sits with the number it explains, on every
                        screen that shows one. See SlaNote. */}
                    <SlaNote slaNote={request.slaNote} />
                </PanelBody>
            </Panel>

            {actions}

            <div className="grid gap-6 lg:grid-cols-2">
                <Panel>
                    <PanelHeader>
                        <PanelTitle>Progress</PanelTitle>
                    </PanelHeader>
                    <PanelBody>
                        <RequestTimeline request={request} now={now} />
                    </PanelBody>
                </Panel>

                <Panel>
                    <PanelHeader>
                        <PanelTitle>Resolution</PanelTitle>
                    </PanelHeader>
                    <PanelBody>
                        {request.resolutionNote ? (
                            <p className="prose-measure text-base text-ink">
                                {request.resolutionNote}
                            </p>
                        ) : (
                            <p className="prose-measure text-base text-ink-soft">
                                {stillOpen
                                    ? 'This request has not been closed, so there is no resolution description yet.'
                                    : 'This request was closed without a resolution description in the record.'}
                            </p>
                        )}
                    </PanelBody>
                </Panel>
            </div>
        </div>
    )
}
