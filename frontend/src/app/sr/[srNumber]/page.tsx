import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageShell } from '@/components/shared/page-heading'
import { RequestDetail } from '@/components/request/request-detail'
import { CitizenProofPanel } from '@/components/layer4/citizen-panel'
import { ErrorNotice, EmptyNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { getHealth, getProgress, getRequestBySrNumber } from '@/lib/api'
import { ApiError } from '@/lib/api-error'
import { normaliseSrNumber } from '@/lib/format'
import type { RequestDetail as RequestDetailShape, RequestProgress as Progress } from '@/types'

export function generateMetadata({ params }: { params: { srNumber: string } }): Metadata {
    return { title: `Request ${normaliseSrNumber(params.srNumber)}` }
}

/**
 * The status of any request, to anyone, with no sign-in.
 *
 * This is the page an SR number is *for*. A person who filed by phone has no
 * account and never will; if checking on their request needed one, the number
 * they were read out would be useless to them. So the only credential is the
 * number itself, and the page is a link that can be forwarded to a neighbour or
 * a council office.
 */
export default async function RequestStatusPage({ params }: { params: { srNumber: string } }) {
    const srNumber = normaliseSrNumber(params.srNumber)

    let request: RequestDetailShape | null = null
    let failure: { notFound: boolean; message: string } | null = null

    try {
        request = await getRequestBySrNumber(srNumber)
    } catch (error) {
        const status = error instanceof ApiError ? error.status : 0
        failure = {
            notFound: status === 404,
            message:
                error instanceof ApiError && status !== 404
                    ? error.message
                    : 'The service did not respond. This is a problem at our end, not with the number you entered.',
        }
    }

    // Read against the same clock the API used to compute `isOverdue`. If the
    // health check is unavailable the page still renders — it falls back to the
    // request's own deadline, which is the one figure that does not move.
    // What has happened, step by step. A failure costs the timeline, not the record.
    let progress: Progress | null = null
    if (request) {
        try {
            progress = await getProgress(srNumber)
        } catch {
            progress = null
        }
    }

    let referenceDate = request?.slaDueAt ?? request?.createdAt ?? new Date().toISOString()
    try {
        referenceDate = (await getHealth()).referenceDate
    } catch {
        // Keep the fallback rather than failing a page whose job is the record.
    }

    return (
        <PageShell>
            <div>
                <Button asChild variant="quiet" size="sm" className="-ml-3">
                    <Link href="/">
                        <ArrowLeft aria-hidden />
                        Look up another request
                    </Link>
                </Button>
            </div>

            {request && (
                <RequestDetail request={request} referenceDate={referenceDate} progress={progress?.steps} />
            )}

            {/* Layer 4, and only for the person who reported this one. */}
            {request && <CitizenProofPanel srNumber={srNumber} />}

            {failure?.notFound && (
                <EmptyNotice title={`No request found for ${srNumber}`}>
                    <p>
                        Check the number for a mistyped character — SR numbers contain digits and
                        letters, and 0 and O are easy to confuse. If it was filed somewhere other
                        than this replica, it will not be found here.
                    </p>
                </EmptyNotice>
            )}

            {failure && !failure.notFound && (
                <ErrorNotice title="Could not load this request" message={failure.message} />
            )}
        </PageShell>
    )
}
