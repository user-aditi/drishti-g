import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LayerMark, StaffName } from '@/components/layer1/marks'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { ReferenceDate } from '@/components/shared/reference-date'
import {
    EmptyRow,
    Pagination,
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'
import { SrNumber, StatusPill } from '@/components/shared/request-bits'
import { Badge } from '@/components/ui/badge'
import { messageFrom } from '@/lib/api-error'
import { toQuery } from '@/lib/api-base'
import { homeFor, requireUser } from '@/lib/auth'
import { formatCount, formatDate, formatDateTime } from '@/lib/format'
import { getEscalations } from '@/lib/layer2-server'
import type { EscalationsPage } from '@/types/layer2'

export const metadata: Metadata = { title: 'Escalations' }
export const dynamic = 'force-dynamic'

/**
 * What climbed the ladder. Layer 2 — NYC 311 has no escalation at all.
 *
 * Highest rung first. The column that matters is the reason: an automatic
 * escalation says the request passed its derived deadline, and a manual one
 * carries the sentence its officer wrote, which is the whole of what the person
 * reading this has to go on.
 *
 * Expect this to be short. NYC's imported history is never escalated — every
 * open imported request is already past its deadline at the snapshot, and the
 * ladder is for live work (I6) — so what appears here is what was filed or acted
 * on through this system.
 */
export default async function EscalationsPageView({
    searchParams,
}: {
    searchParams: Record<string, string | string[] | undefined>
}) {
    const user = await requireUser()
    if (user.role !== 'SUPERVISOR' && user.role !== 'COMMISSIONER') redirect(homeFor(user.role))

    const raw = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page
    const page = Math.max(1, Number(raw) || 1)

    let data: EscalationsPage | null = null
    let error: string | null = null
    try {
        data = await getEscalations({ page })
    } catch (err) {
        error = messageFrom(err, 'The escalation register could not be loaded.')
    }

    // Supervisors can open the officer's working view; the commissioner reads
    // the public record, since assignment and work orders are not theirs to run.
    const hrefFor = (sr: string) =>
        user.role === 'SUPERVISOR' ? `/officer/sr/${encodeURIComponent(sr)}` : `/sr/${encodeURIComponent(sr)}`

    return (
        <PageShell>
            <PageHeading
                title="Escalations"
                actions={<LayerMark layer={2} />}
                description={`${user.agency?.name ?? 'Your agency'}: open requests that have climbed past their officer — to the supervisor when they pass their derived deadline, to the borough commissioner past twice their service level, or sooner when someone raised them by hand.`}
            />

            {error ? (
                <ErrorNotice title="Could not load escalations" message={error} />
            ) : (
                data && (
                    <>
                        <p className="text-[14.5px] text-ink-mid">
                            <span className="mono text-ink">{formatCount(data.total)}</span> escalated and still open.
                        </p>
                        <ReferenceDate referenceDate={data.referenceDate} />
                        <RegisterFrame>
                            <RegisterTable caption="Escalated requests, highest rung first">
                                <RegisterHead>
                                    <Th>SR number</Th>
                                    <Th>Type</Th>
                                    <Th>Board</Th>
                                    <Th>Status</Th>
                                    <Th>Rung</Th>
                                    <Th>Officer</Th>
                                    <Th>Latest reason</Th>
                                    <Th>Escalated</Th>
                                    <Th>Derived due</Th>
                                </RegisterHead>
                                <RegisterBody>
                                    {data.rows.length === 0 ? (
                                        <EmptyRow colSpan={9}>
                                            Nothing has been escalated. Requests arrive here when they pass their
                                            derived deadline, or when their officer raises them.
                                        </EmptyRow>
                                    ) : (
                                        data.rows.map((row) => {
                                            const latest = row.escalations[row.escalations.length - 1]
                                            return (
                                                <Tr key={row.id}>
                                                    <Td mono>
                                                        <Link
                                                            href={hrefFor(row.srNumber)}
                                                            className="text-brand underline underline-offset-2"
                                                        >
                                                            <SrNumber value={row.srNumber} />
                                                        </Link>
                                                    </Td>
                                                    <Td>{row.type?.name}</Td>
                                                    <Td mono>{row.orgUnit?.code ?? '—'}</Td>
                                                    <Td>
                                                        <StatusPill status={row.status} />
                                                    </Td>
                                                    <Td>
                                                        <Badge tone="new">{row.escalationLevelName}</Badge>
                                                    </Td>
                                                    <Td>
                                                        {row.accountable ? (
                                                            <StaffName
                                                                name={row.accountable.name}
                                                                isSynthetic={row.accountable.isSynthetic}
                                                            />
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </Td>
                                                    <Td className="max-w-72 text-sm">
                                                        {latest
                                                            ? latest.trigger === 'MANUAL'
                                                                ? `“${latest.reason}”`
                                                                : `${latest.reason} †`
                                                            : '—'}
                                                    </Td>
                                                    <Td mono className="whitespace-nowrap">
                                                        {latest ? formatDateTime(latest.at) : '—'}
                                                    </Td>
                                                    <Td mono className="whitespace-nowrap">
                                                        {formatDate(row.slaDueAt)}
                                                    </Td>
                                                </Tr>
                                            )
                                        })
                                    )}
                                </RegisterBody>
                            </RegisterTable>
                        </RegisterFrame>
                        {data.total > data.pageSize && (
                            <Pagination
                                page={data.page}
                                pageSize={data.pageSize}
                                total={data.total}
                                hrefForPage={(next: number) => `/supervisor/escalations${toQuery({ page: next })}`}
                            />
                        )}
                    </>
                )
            )}
        </PageShell>
    )
}
