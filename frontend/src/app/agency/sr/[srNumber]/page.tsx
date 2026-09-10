import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatusActions } from './status-actions'
import { RequestDetail } from '@/components/request/request-detail'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { ErrorNotice } from '@/components/shared/notices'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { getHealth, getRequestBySrNumber } from '@/lib/api'
import { ApiError, messageFrom } from '@/lib/api-error'
import { requireUser } from '@/lib/auth'
import { normaliseSrNumber } from '@/lib/format'
import type { RequestDetail as RequestDetailShape } from '@/types'

export const dynamic = 'force-dynamic'

export function generateMetadata({ params }: { params: { srNumber: string } }): Metadata {
    return { title: `${normaliseSrNumber(decodeURIComponent(params.srNumber))} · Queue` }
}

/**
 * One request, as the agency works it.
 *
 * Addressed by SR number rather than by database id, and deliberately: the SR
 * number is the handle a citizen holds, the API exposes no other way to fetch a
 * single request, and using it here means the agent and the public are demonstrably
 * reading the same record rather than two shapes of it. The numeric id still
 * exists and is what the status write uses — it just is not the address.
 */
export default async function AgencyRequestPage({ params }: { params: { srNumber: string } }) {
    const user = await requireUser('AGENT')
    const srNumber = normaliseSrNumber(decodeURIComponent(params.srNumber))

    let request: RequestDetailShape
    try {
        request = await getRequestBySrNumber(srNumber)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        return (
            <PageShell>
                <ErrorNotice
                    title="Could not load this request"
                    message={messageFrom(err, 'The request could not be loaded.')}
                />
            </PageShell>
        )
    }

    let referenceDate = new Date().toISOString()
    try {
        referenceDate = (await getHealth()).referenceDate
    } catch {
        // The record still reads; only the relative ages fall back to the clock.
    }

    // An agent works their own agency's requests. The API enforces this on the
    // write as well — this is so the screen does not offer a control that would
    // be refused.
    const mine = user.agency === null || request.agency?.id === user.agency.id

    return (
        <PageShell>
            <PageHeading
                title="Service request"
                description={
                    <>
                        Working view.{' '}
                        <Link
                            href={`/sr/${encodeURIComponent(request.srNumber)}`}
                            className="text-brand underline underline-offset-2"
                        >
                            See what the public sees
                        </Link>
                        .
                    </>
                }
            />

            <RequestDetail
                request={request}
                referenceDate={referenceDate}
                actions={
                    <Panel>
                        <PanelHeader>
                            <PanelTitle>Update</PanelTitle>
                        </PanelHeader>
                        <PanelBody>
                            {mine ? (
                                <StatusActions
                                    requestId={request.id}
                                    current={request.status}
                                    isImported={request.isImported}
                                    hasNote={Boolean(request.resolutionNote)}
                                />
                            ) : (
                                <p className="text-[13.5px] text-ink-mid">
                                    This request belongs to{' '}
                                    {request.agency?.name ?? 'another agency'}. Only that
                                    agency can change its status.
                                </p>
                            )}
                        </PanelBody>
                    </Panel>
                }
            />
        </PageShell>
    )
}
