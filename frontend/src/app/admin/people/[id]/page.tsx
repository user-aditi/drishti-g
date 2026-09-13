import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LayerMark, StaffName } from '@/components/layer1/marks'
import { AccountAccessForm, MovePostingForm } from '@/components/layer3/person-actions'
import { ErrorNotice, InfoNotice } from '@/components/shared/notices'
import { Field, PageHeading, PageShell } from '@/components/shared/page-heading'
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
import { Badge } from '@/components/ui/badge'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { ApiError, messageFrom } from '@/lib/api-error'
import { homeFor, requireUser } from '@/lib/auth'
import { formatCount, formatDate, formatDateTime, humanise } from '@/lib/format'
import { getPerson } from '@/lib/layer3-server'
import type { PersonDetail } from '@/types/layer3'

export const metadata: Metadata = { title: 'Person' }
export const dynamic = 'force-dynamic'

/**
 * One member of staff: where they are posted, where they have been, what the
 * chain records about them, and the two changes an administrator can make.
 *
 * Both changes explain their consequence before they are made. Moving or
 * deactivating an officer hands on their open requests, and whoever does it
 * should know that from this page rather than discover it from the supervisor.
 */
export default async function PersonPage({ params }: { params: { id: string } }) {
    const user = await requireUser()
    if (user.role !== 'ADMIN') redirect(homeFor(user.role))

    const id = Number(params.id)
    if (!Number.isInteger(id)) notFound()

    let data: PersonDetail | null = null
    let error: string | null = null
    try {
        data = await getPerson(id)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        error = messageFrom(err, 'This person could not be loaded.')
    }

    if (error || !data) {
        return (
            <PageShell>
                <ErrorNotice title="Could not load this person" message={error ?? 'Unknown error'} />
            </PageShell>
        )
    }

    const { person } = data
    const current = person.postings.find((posting) => posting.endedAt === null) ?? null
    const isOfficer = person.role === 'OFFICER'

    return (
        <PageShell>
            <p className="text-sm">
                <Link href="/admin/people" className="text-brand underline underline-offset-2">
                    People
                </Link>
            </p>
            <PageHeading
                title={person.name}
                actions={<LayerMark layer={3} />}
                description={`${humanise(person.role)}${person.agency ? `, ${person.agency.name}` : ''}.`}
            />

            <Panel>
                <PanelBody>
                    <dl>
                        <Field label="Name">
                            <StaffName name={person.name} isSynthetic={person.isSynthetic} />
                        </Field>
                        <Field label="Email" mono>
                            {person.email}
                        </Field>
                        <Field label="Account">
                            {person.isActive ? <Badge tone="done">Active</Badge> : <Badge tone="stop">Deactivated</Badge>}
                        </Field>
                        <Field label="Posted to">
                            {!person.posted
                                ? 'Not a posted role'
                                : current
                                  ? `${current.orgUnit.code} · ${current.orgUnit.name}, since ${formatDate(current.startedAt)}`
                                  : 'Not posted anywhere'}
                        </Field>
                        {isOfficer && (
                            <Field label="Open requests">
                                <span className="mono">{formatCount(person.openAssigned)}</span>
                            </Field>
                        )}
                    </dl>
                </PanelBody>
            </Panel>

            {person.posted && (
                <Panel>
                    <PanelHeader>
                        <PanelTitle>Move to another post</PanelTitle>
                    </PanelHeader>
                    <PanelBody>
                        <div className="flex flex-col gap-3">
                            {isOfficer && (
                                <InfoNotice>
                                    Any open request this officer can no longer answer for goes to whoever the posting
                                    rule picks on its board, or stays unassigned for the supervisor if nobody is posted
                                    there.
                                </InfoNotice>
                            )}
                            <MovePostingForm
                                userId={person.id}
                                agencies={data.agencies}
                                units={data.units}
                                current={{ agencyId: person.agency?.id ?? null, orgUnitId: current?.orgUnit.id ?? null }}
                            />
                        </div>
                    </PanelBody>
                </Panel>
            )}

            <Panel>
                <PanelHeader>
                    <PanelTitle>{person.isActive ? 'Deactivate' : 'Reactivate'}</PanelTitle>
                </PanelHeader>
                <PanelBody>
                    {data.isSelf ? (
                        <p className="text-base text-ink-mid">
                            This is your own account. Another administrator would have to change its access.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <p className="text-base text-ink-mid">
                                {person.isActive
                                    ? `Deactivating stops ${person.name} signing in from their next request.${isOfficer ? ' Their open requests are handed on at once.' : ''}`
                                    : 'Reactivating gives back the account and its posting, not requests already handed on.'}
                            </p>
                            <AccountAccessForm userId={person.id} isActive={person.isActive} name={person.name} />
                        </div>
                    )}
                </PanelBody>
            </Panel>

            {person.posted && (
                <RegisterFrame>
                    <RegisterTable caption="Postings, most recent first">
                        <RegisterHead>
                            <Th>Agency</Th>
                            <Th>Post</Th>
                            <Th>From</Th>
                            <Th>Until</Th>
                        </RegisterHead>
                        <RegisterBody>
                            {person.postings.length === 0 ? (
                                <EmptyRow colSpan={4}>Never posted.</EmptyRow>
                            ) : (
                                person.postings.map((posting) => (
                                    <Tr key={posting.id}>
                                        <Td mono>{posting.agency.code}</Td>
                                        <Td>
                                            <span className="mono">{posting.orgUnit.code}</span> {posting.orgUnit.name}
                                        </Td>
                                        <Td mono>{formatDateTime(posting.startedAt)}</Td>
                                        <Td mono>{posting.endedAt ? formatDateTime(posting.endedAt) : 'Current'}</Td>
                                    </Tr>
                                ))
                            )}
                        </RegisterBody>
                    </RegisterTable>
                </RegisterFrame>
            )}

            <RegisterFrame>
                <RegisterTable caption="On the audit chain: changes to this account, and the latest things this person did">
                    <RegisterHead>
                        <Th>When</Th>
                        <Th>Action</Th>
                        <Th>By</Th>
                        <Th>Detail</Th>
                    </RegisterHead>
                    <RegisterBody>
                        {data.history.length === 0 ? (
                            <EmptyRow colSpan={4}>Nothing recorded.</EmptyRow>
                        ) : (
                            data.history.map((event) => (
                                <Tr key={event.id}>
                                    <Td mono className="whitespace-nowrap">
                                        {formatDateTime(event.createdAt)}
                                    </Td>
                                    <Td mono>{event.action}</Td>
                                    <Td>{event.actorLabel ?? 'system'}</Td>
                                    <Td className="max-w-md text-sm text-ink-mid">
                                        {typeof event.payload?.reason === 'string'
                                            ? `“${event.payload.reason}”`
                                            : `${event.entityType} ${event.entityId}`}
                                    </Td>
                                </Tr>
                            ))
                        )}
                    </RegisterBody>
                </RegisterTable>
            </RegisterFrame>
        </PageShell>
    )
}
