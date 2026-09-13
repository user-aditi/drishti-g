import type { Metadata } from 'next'
import { QueueFilters } from './filters'
import { CsvLink } from '@/components/shared/csv-link'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { RequestRegister } from '@/components/request/request-register'
import { ErrorNotice } from '@/components/shared/notices'
import { ReferenceDate } from '@/components/shared/reference-date'
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, parseSort } from '@/lib/constants'
import { getBoards, getRequestPage, getTaxonomy } from '@/lib/api'
import { messageFrom } from '@/lib/api-error'
import { requireUser } from '@/lib/auth'
import { toQuery } from '@/lib/api-base'
import type { Board, Paged, RequestStatus, RequestType, ServiceRequest } from '@/types'

export const metadata: Metadata = { title: 'Agency queue' }
export const dynamic = 'force-dynamic'

type Search = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value

const asNumber = (value: string | undefined): number | undefined => {
    const parsed = Number(value)
    return value && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * The agency queue — the screen this system is actually used from.
 *
 * Everything about it is server-driven: the filters, the ordering and the page
 * are all read from the URL and answered by one API call that returns fifty
 * rows and a total. That is not an architectural preference. There are 355,430
 * requests behind this register, and any version that fetched them to filter or
 * count in the browser would work perfectly against a seeded database and fall
 * over the first time it met the real corpus.
 *
 * It also means a filtered queue is a link. "The DEP backlog in BK-08, oldest
 * first" is a URL somebody can send, rather than a sequence of clicks they have
 * to describe.
 *
 * An agent sees their own agency and no other. That is the whole of Layer 0's
 * access model, and it is the only one NYC's data can support: 311 records
 * which agency owns a request and never which person, so there is no individual
 * ownership here to scope to.
 */
export default async function AgencyQueuePage({ searchParams }: { searchParams: Search }) {
    const user = await requireUser('AGENT')

    const sort = parseSort(one(searchParams.sort))
    const page = asNumber(one(searchParams.page)) ?? 1
    const requestedSize = asNumber(one(searchParams.pageSize)) ?? DEFAULT_PAGE_SIZE
    const pageSize = PAGE_SIZES.includes(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE

    const filters = {
        orgUnitId: asNumber(one(searchParams.orgUnitId)),
        typeId: asNumber(one(searchParams.typeId)),
        status: one(searchParams.status) as RequestStatus | undefined,
        openOnly: one(searchParams.openOnly) === 'true',
        overdue: one(searchParams.overdue) === 'true',
        q: one(searchParams.q)?.trim() || undefined,
    }

    let result: Paged<ServiceRequest> | null = null
    let boards: Board[] = []
    let types: RequestType[] = []
    let error: string | null = null

    try {
        ;[result, boards, types] = await Promise.all([
            getRequestPage({ ...filters, sort, page, pageSize }),
            getBoards(),
            getTaxonomy(),
        ])
    } catch (err) {
        error = messageFrom(err, 'The queue could not be loaded.')
    }

    /** Every link out of this page keeps the filters and changes one thing. */
    const hrefWith = (overrides: Record<string, string | number | boolean | undefined>) =>
        `/agency/queue${toQuery({ ...filters, sort, page, pageSize, ...overrides })}`

    return (
        <PageShell>
            <PageHeading
                title={user.agency ? `${user.agency.name} queue` : 'Agency queue'}
                actions={<CsvLink path={`/requests/export/csv${toQuery({ ...filters, sort })}`} />}
                description={
                    user.agency
                        ? `Every ${user.agency.code} service request in Brooklyn. Accountability here is the agency's, not any one person's — which is how 311 works, and all its data records.`
                        : 'Service requests across every agency.'
                }
            />

            {error ? (
                <ErrorNotice title="Could not load the queue" message={error} />
            ) : (
                result && (
                    <>
                        <QueueFilters boards={boards} types={types} />

                        {/* Shown here always, not only when something is overdue:
                            this register can be *sorted* by deadline, so the day
                            the deadlines are measured against is part of reading
                            it at all. */}
                        <ReferenceDate referenceDate={result.referenceDate} />

                        <RequestRegister
                            rows={result.rows}
                            page={result.page}
                            pageSize={result.pageSize}
                            total={result.total}
                            referenceDate={result.referenceDate}
                            sort={sort}
                            hrefForSort={(next) => hrefWith({ sort: next, page: 1 })}
                            hrefForPage={(next) => hrefWith({ page: next })}
                            hrefForRow={(request) => `/agency/sr/${encodeURIComponent(request.srNumber)}`}
                            emptyMessage="No requests match these filters."
                        />
                    </>
                )
            )}
        </PageShell>
    )
}
