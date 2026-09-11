import {
    EmptyRow,
    Pagination,
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    RowLink,
    SortHeader,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'
import { SlaFootnote } from '@/components/shared/sla-note'
import { StatusPill } from '@/components/shared/request-bits'
import { EMPTY, ageHours, asOf, formatDate, formatHours } from '@/lib/format'
import type { QueueSort, ServiceRequest } from '@/types'

/**
 * The register of service requests.
 *
 * One component behind both the citizen's own list and the agent's queue, so
 * the same request reads identically in both. It renders exactly the page it
 * was handed and takes the total on trust from the server — with 355,430 rows
 * behind it, anything that counted, filtered or sorted in the browser would be
 * a bug waiting for a slow afternoon.
 *
 * Sorting is likewise the server's job, and only the three orders it implements
 * are offered. A fourth sortable column would have to reorder the fifty rows in
 * hand and present that as an ordering of the whole register, which is wrong in
 * a way nobody notices until page two.
 */
export function RequestRegister({
    rows,
    page,
    pageSize,
    total,
    referenceDate,
    sort,
    hrefForSort,
    hrefForPage,
    hrefForRow,
    emptyMessage,
    showBoard = true,
}: {
    rows: ServiceRequest[]
    page: number
    pageSize: number
    total: number
    /**
     * The day the server evaluated these rows on. Ages and deadlines are
     * measured against it, never against the reader's clock — see ReferenceDate.
     */
    referenceDate: string
    sort?: QueueSort
    /** Omitted on a list the API does not let anyone reorder. */
    hrefForSort?: (sort: QueueSort) => string
    hrefForPage: (page: number) => string
    hrefForRow: (request: ServiceRequest) => string
    emptyMessage: React.ReactNode
    showBoard?: boolean
}) {
    const now = asOf(referenceDate)
    const columns = showBoard ? 8 : 7

    /** A header sorts only where the API can honour it. */
    const filedHeader = hrefForSort ? (
        <SortHeader
            href={hrefForSort(sort === 'age' ? 'newest' : 'age')}
            direction={sort === 'age' ? 'asc' : sort === 'newest' ? 'desc' : null}
        >
            Filed
        </SortHeader>
    ) : (
        <Th>Filed</Th>
    )

    const dueHeader = hrefForSort ? (
        <SortHeader href={hrefForSort('due')} direction={sort === 'due' ? 'asc' : null} align="right">
            Deadline †
        </SortHeader>
    ) : (
        <Th align="right">Deadline †</Th>
    )

    return (
        <div className="flex flex-col gap-3">
            <RegisterFrame>
                <RegisterTable caption="Service requests">
                    <RegisterHead>
                        <Th>SR number</Th>
                        <Th>Type</Th>
                        <Th>Agency</Th>
                        {showBoard && <Th>Board</Th>}
                        <Th>Status</Th>
                        {filedHeader}
                        <Th align="right">Age</Th>
                        {dueHeader}
                    </RegisterHead>

                    <RegisterBody>
                        {rows.length === 0 && <EmptyRow colSpan={columns}>{emptyMessage}</EmptyRow>}

                        {rows.map((request) => {
                            const stillOpen = request.status !== 'CLOSED'
                            const overdue = request.isOverdue && stillOpen
                            // NYC's rows are measured at the snapshot they were pulled
                            // at; this system's own filings are live, and age in real time.
                            const rowNow = request.isImported ? now : Date.now()

                            return (
                                <Tr key={request.id}>
                                    <Td mono>
                                        <RowLink href={hrefForRow(request)}>
                                            {request.srNumber}
                                        </RowLink>
                                    </Td>
                                    <Td className="max-w-64 truncate text-ink">
                                        {request.type?.name ?? EMPTY}
                                        {request.descriptor && (
                                            <span className="block truncate text-sm text-ink-soft">
                                                {request.descriptor.name}
                                            </span>
                                        )}
                                    </Td>
                                    <Td mono>{request.agency?.code ?? EMPTY}</Td>
                                    {showBoard && <Td mono>{request.orgUnit?.code ?? EMPTY}</Td>}
                                    <Td>
                                        <StatusPill status={request.status} />
                                    </Td>
                                    <Td mono className="whitespace-nowrap">
                                        {formatDate(request.createdAt)}
                                    </Td>
                                    <Td mono align="right" className="whitespace-nowrap">
                                        {formatHours(
                                            ageHours(request.createdAt, request.closedAt, request.status, rowNow),
                                        )}
                                    </Td>
                                    <Td align="right" className="whitespace-nowrap">
                                        {/* Overdue is a comparison against a deadline we
                                            derived, so it is reported in the deadline
                                            column — never mixed into the status column,
                                            where it would pass as one of NYC's own. */}
                                        {overdue ? (
                                            <span className="mono font-medium text-stop">
                                                Past due<span aria-hidden> †</span>
                                            </span>
                                        ) : (
                                            <span className="mono text-ink-soft">
                                                {request.slaDueAt
                                                    ? formatDate(request.slaDueAt)
                                                    : EMPTY}
                                            </span>
                                        )}
                                    </Td>
                                </Tr>
                            )
                        })}
                    </RegisterBody>
                </RegisterTable>

                <Pagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    hrefForPage={hrefForPage}
                />
            </RegisterFrame>

            <SlaFootnote />
        </div>
    )
}
