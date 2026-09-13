import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LayerMark, StaffName } from '@/components/layer1/marks'
import { AcknowledgeControl } from '@/components/layer2/acknowledge-control'
import { ErrorNotice } from '@/components/shared/notices'
import { CsvLink } from '@/components/shared/csv-link'
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
import { cn } from '@/lib/utils'
import { formatCount, formatDate, formatDateTime, relativeTime } from '@/lib/format'
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
 * reading this has to go on. Beside it, whether whoever holds the rung has said
 * they have it — the difference between an escalation that was read and one
 * that was not.
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

    const first = (key: string) => {
        const value = searchParams[key]
        return Array.isArray(value) ? value[0] : value
    }
    const page = Math.max(1, Number(first('page')) || 1)
    const showAll = first('show') === 'all'

    let data: EscalationsPage | null = null
    let error: string | null = null
    try {
        data = await getEscalations({ page, openOnly: !showAll })
    } catch (err) {
        error = messageFrom(err, 'The escalation register could not be loaded.')
    }

    // Supervisors can open the officer's working view; the commissioner reads
    // the public record, since assignment and work orders are not theirs to run.
    const hrefFor = (sr: string) =>
        user.role === 'SUPERVISOR' ? `/officer/sr/${encodeURIComponent(sr)}` : `/sr/${encodeURIComponent(sr)}`
    const hrefWith = (params: { page?: number; show?: string }) =>
        `/supervisor/escalations${toQuery({ show: showAll ? 'all' : undefined, ...params })}`

    return (
        <PageShell>
            <PageHeading
                title="Escalations"
                actions={
                    <>
                        <CsvLink path={`/escalations/export/csv?openOnly=${showAll ? 'false' : 'true'}`} />
                        <LayerMark layer={2} />
                    </>
                }
                description={`${user.agency?.name ?? 'Your agency'}: requests that have climbed past their officer — to the supervisor when they pass their derived deadline, to the borough commissioner past twice their service level, or sooner when someone raised them by hand.`}
            />

            <nav aria-label="Which escalations" className="flex gap-2 text-sm">
                {[
                    { label: 'Still open', href: '/supervisor/escalations', current: !showAll },
                    { label: 'Include resolved', href: '/supervisor/escalations?show=all', current: showAll },
                ].map((tab) => (
                    <Link
                        key={tab.label}
                        href={tab.href}
                        aria-current={tab.current ? 'page' : undefined}
                        className={cn(
                            'rounded-[var(--radius)] border px-3 py-1',
                            tab.current ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong text-ink-mid hover:bg-sunk',
                        )}
                    >
                        {tab.label}
                    </Link>
                ))}
            </nav>

            {error ? (
                <ErrorNotice title="Could not load escalations" message={error} />
            ) : (
                data && (
                    <>
                        <p className="text-[14.5px] text-ink-mid">
                            <span className="mono text-ink">{formatCount(data.total)}</span>{' '}
                            {showAll ? 'escalated, open or resolved.' : 'escalated and still open.'}
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
                                    <Th>Acknowledged</Th>
                                    <Th>Derived due</Th>
                                </RegisterHead>
                                <RegisterBody>
                                    {data.rows.length === 0 ? (
                                        <EmptyRow colSpan={10}>
                                            Nothing has been escalated. Requests arrive here when they pass their
                                            derived deadline, or when their officer raises them.
                                        </EmptyRow>
                                    ) : (
                                        data.rows.map((row) => {
                                            const latest = row.escalations[row.escalations.length - 1]
                                            // The rung this viewer holds, if any is still waiting on them.
                                            const mine = row.escalations.find((rung) =>
                                                row.acknowledgeable.includes(rung.id),
                                            )
                                            const acknowledged = [...row.escalations]
                                                .reverse()
                                                .find((rung) => rung.acknowledgedAt !== null)
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
                                                    <Td className="whitespace-nowrap">
                                                        {latest ? (
                                                            <span className="flex flex-col">
                                                                {/* Escalations are events in this system, so real time. */}
                                                                <span className="text-sm text-ink">
                                                                    {relativeTime(latest.at)}
                                                                </span>
                                                                <span className="mono text-xs text-ink-soft">
                                                                    {formatDateTime(latest.at)}
                                                                </span>
                                                                {latest.resolvedAt && (
                                                                    <span className="text-xs text-done">
                                                                        Resolved {relativeTime(latest.resolvedAt)}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </Td>
                                                    <Td className="max-w-72 text-sm">
                                                        {mine ? (
                                                            <AcknowledgeControl
                                                                escalationId={mine.id}
                                                                srNumber={row.srNumber}
                                                            />
                                                        ) : acknowledged ? (
                                                            <span className="flex flex-col gap-0.5">
                                                                <span className="text-ink">
                                                                    {acknowledged.acknowledgedBy?.name ?? 'Someone'},{' '}
                                                                    {relativeTime(acknowledged.acknowledgedAt)}
                                                                </span>
                                                                <span className="text-ink-mid">
                                                                    &ldquo;{acknowledged.acknowledgeNote}&rdquo;
                                                                </span>
                                                            </span>
                                                        ) : (
                                                            <span className="text-wait">Not yet</span>
                                                        )}
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
                                hrefForPage={(next: number) => hrefWith({ page: next })}
                            />
                        )}
                    </>
                )
            )}
        </PageShell>
    )
}
