import type { Metadata } from 'next'
import { LayerMark } from '@/components/layer1/marks'
import { RequestRegister } from '@/components/request/request-register'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { ReferenceDate } from '@/components/shared/reference-date'
import { messageFrom } from '@/lib/api-error'
import { toQuery } from '@/lib/api-base'
import { requireUser } from '@/lib/auth'
import { formatCount } from '@/lib/format'
import { getDesk } from '@/lib/layer1-server'
import type { Desk } from '@/types/layer1'

export const metadata: Metadata = { title: 'My desk' }
export const dynamic = 'force-dynamic'

/**
 * The requests this officer personally answers for.
 *
 * Layer 1, and the clearest statement of what Layer 1 adds: NYC 311 holds an
 * agency accountable and records no person at all, so this list — one named
 * officer, a specific set of requests — has no counterpart in the real service.
 *
 * Ordered by derived deadline, not by age, because a desk answers "what do I do
 * next". Against a historical snapshot nearly all of it is already late, so the
 * order runs from most overdue to least; the reference-date banner says why.
 * Sorting is not offered: the one order this screen exists for is the only one
 * it has.
 */
export default async function OfficerDeskPage({
    searchParams,
}: {
    searchParams: Record<string, string | string[] | undefined>
}) {
    const user = await requireUser('OFFICER')
    const raw = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page
    const page = Math.max(1, Number(raw) || 1)

    let desk: Desk | null = null
    let error: string | null = null
    try {
        desk = await getDesk({ page })
    } catch (err) {
        error = messageFrom(err, 'Your desk could not be loaded.')
    }

    return (
        <PageShell>
            <PageHeading
                title="My desk"
                actions={<LayerMark />}
                description={`Every open request that ${user.name} answers for, most urgent first. A named person answering for a request is this project's addition — NYC 311 records the agency, never an individual.`}
            />

            {error ? (
                <ErrorNotice title="Could not load your desk" message={error} />
            ) : (
                desk && (
                    <>
                        <p className="text-[14.5px] text-ink-mid">
                            <span className="mono text-ink">{formatCount(desk.total)}</span> open,{' '}
                            <span className="mono text-stop">{formatCount(desk.overdue)}</span> past
                            their derived deadline.
                        </p>
                        <ReferenceDate referenceDate={desk.referenceDate} />
                        <RequestRegister
                            rows={desk.rows}
                            page={desk.page}
                            pageSize={desk.pageSize}
                            total={desk.total}
                            referenceDate={desk.referenceDate}
                            hrefForPage={(next) => `/officer/desk${toQuery({ page: next })}`}
                            hrefForRow={(request) =>
                                `/officer/sr/${encodeURIComponent(request.srNumber)}`
                            }
                            emptyMessage="Nothing is assigned to you. Requests arrive here when the posting rule or a supervisor gives you one."
                        />
                    </>
                )
            )}
        </PageShell>
    )
}
