import type { Metadata } from 'next'
import { AssignControl, ReassignBySr } from './assign-control'
import { LayerMark, StaffName } from '@/components/layer1/marks'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import {
    EmptyRow,
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'
import { SrNumber, StatusPill } from '@/components/shared/request-bits'
import { messageFrom } from '@/lib/api-error'
import { requireUser } from '@/lib/auth'
import { formatCount, formatDate } from '@/lib/format'
import { getOfficers, getUnassigned } from '@/lib/layer1-server'
import type { OfficerSummary, UnassignedPage } from '@/types/layer1'

export const metadata: Metadata = { title: 'Assign' }
export const dynamic = 'force-dynamic'

/**
 * Assignment by hand. Layer 1 — NYC 311 has no equivalent.
 *
 * Two registers. The first is every open request in the agency that nobody
 * answers for, and after the backfill it should be empty: Layer 1's gate is that
 * every open request has exactly one accountable person, so anything listed
 * there is a counterexample — almost always a board with nobody posted to it.
 * An empty list is the success state, not a placeholder.
 *
 * The second is the officers and what each holds, because the question a
 * supervisor actually has is "who is carrying too much", and that is a column to
 * compare down, not a card to open.
 */
export default async function SupervisorAssignPage() {
    const user = await requireUser('SUPERVISOR')

    let unassigned: UnassignedPage | null = null
    let officers: OfficerSummary[] = []
    let error: string | null = null
    try {
        ;[unassigned, officers] = await Promise.all([getUnassigned({ page: 1 }), getOfficers()])
    } catch (err) {
        error = messageFrom(err, 'The assignment screen could not be loaded.')
    }

    return (
        <PageShell>
            <PageHeading
                title="Assign"
                actions={<LayerMark />}
                description={`${user.agency?.name ?? 'Your agency'}: open requests nobody answers for, and the officers who can take them. Naming one person per request is this project's addition; NYC 311 holds only the agency accountable.`}
            />

            {error ? (
                <ErrorNotice title="Could not load assignments" message={error} />
            ) : (
                unassigned && (
                    <>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-[19px] font-semibold text-ink">
                                Unassigned{' '}
                                <span className="mono text-ink-soft">{formatCount(unassigned.total)}</span>
                            </h2>
                            <RegisterFrame>
                                <RegisterTable caption="Open requests with no accountable officer">
                                    <RegisterHead>
                                        <Th>SR number</Th>
                                        <Th>Type</Th>
                                        <Th>Board</Th>
                                        <Th>Status</Th>
                                        <Th>Filed</Th>
                                        <Th>Assign to</Th>
                                    </RegisterHead>
                                    <RegisterBody>
                                        {unassigned.rows.length === 0 ? (
                                            <EmptyRow colSpan={6}>
                                                Every open request in this agency has an accountable officer.
                                            </EmptyRow>
                                        ) : (
                                            unassigned.rows.map((row) => (
                                                <Tr key={row.id}>
                                                    <Td mono>
                                                        <SrNumber value={row.srNumber} />
                                                    </Td>
                                                    <Td>{row.type?.name}</Td>
                                                    <Td mono>{row.orgUnit?.code ?? '—'}</Td>
                                                    <Td>
                                                        <StatusPill status={row.status} />
                                                    </Td>
                                                    <Td mono>{formatDate(row.createdAt)}</Td>
                                                    <Td>
                                                        <AssignControl
                                                            requestId={row.id}
                                                            boardCode={row.orgUnit?.code ?? null}
                                                            officers={officers}
                                                        />
                                                    </Td>
                                                </Tr>
                                            ))
                                        )}
                                    </RegisterBody>
                                </RegisterTable>
                            </RegisterFrame>
                        </section>

                        <section className="flex flex-col gap-3">
                            <h2 className="text-[19px] font-semibold text-ink">Reassign a request</h2>
                            <ReassignBySr officers={officers} />
                        </section>

                        <section className="flex flex-col gap-3">
                            <h2 className="text-[19px] font-semibold text-ink">
                                Officers{' '}
                                <span className="mono text-ink-soft">{formatCount(officers.length)}</span>
                            </h2>
                            <RegisterFrame>
                                <RegisterTable caption="Officers in this agency and the open requests each holds">
                                    <RegisterHead>
                                        <Th>Officer</Th>
                                        <Th>Posted to</Th>
                                        <Th align="right">Open requests held</Th>
                                    </RegisterHead>
                                    <RegisterBody>
                                        {officers.length === 0 ? (
                                            <EmptyRow colSpan={3}>No officers are posted to this agency.</EmptyRow>
                                        ) : (
                                            officers.map((officer) => (
                                                <Tr key={officer.id}>
                                                    <Td>
                                                        <StaffName
                                                            name={officer.name}
                                                            isSynthetic={officer.isSynthetic}
                                                        />
                                                    </Td>
                                                    <Td mono>
                                                        {officer.units.map((u) => u.code).join(', ')}
                                                    </Td>
                                                    <Td align="right" mono>
                                                        {formatCount(officer.openLoad)}
                                                    </Td>
                                                </Tr>
                                            ))
                                        )}
                                    </RegisterBody>
                                </RegisterTable>
                            </RegisterFrame>
                        </section>
                    </>
                )
            )}
        </PageShell>
    )
}
