import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LayerMark } from '@/components/layer1/marks'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { messageFrom } from '@/lib/api-error'
import { toQuery } from '@/lib/api-base'
import { homeFor, requireUser } from '@/lib/auth'
import { formatCount, humanise } from '@/lib/format'
import { getPeople } from '@/lib/layer3-server'
import type { PeoplePage } from '@/types/layer3'

export const metadata: Metadata = { title: 'People' }
export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined

const ROLES = ['AGENT', 'OFFICER', 'SUPERVISOR', 'COMMISSIONER', 'ADMIN'] as const

/**
 * Everyone who works in the system, by agency and post.
 *
 * A register, filtered the way the question comes: who is posted to this board,
 * which officers are carrying open work, which accounts are switched off. Each
 * name opens the person, where their posting history is and where they can be
 * moved or deactivated — a change serious enough to deserve its own page rather
 * than a button in a row.
 *
 * Staff only. Residents are not browsed from here.
 */
export default async function PeoplePageView({
    searchParams,
}: {
    searchParams: Record<string, string | string[] | undefined>
}) {
    const user = await requireUser()
    if (user.role !== 'ADMIN') redirect(homeFor(user.role))

    const filters = {
        agencyId: Number(one(searchParams.agencyId)) || undefined,
        orgUnitId: Number(one(searchParams.orgUnitId)) || undefined,
        role: one(searchParams.role),
        active: one(searchParams.active),
        q: one(searchParams.q),
    }
    const page = Math.max(1, Number(one(searchParams.page)) || 1)

    let data: PeoplePage | null = null
    let error: string | null = null
    try {
        data = await getPeople({ ...filters, page })
    } catch (err) {
        error = messageFrom(err, 'The people register could not be loaded.')
    }

    return (
        <PageShell>
            <PageHeading
                title="People"
                actions={<LayerMark layer={3} />}
                description="Staff by agency and post. Open a person to move their posting or switch their account off; both go on the audit chain, and an officer's open requests are handed on when they can no longer answer for them."
            />

            {error ? (
                <ErrorNotice title="Could not load people" message={error} />
            ) : (
                data && (
                    <>
                        <form method="get" className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                Name or email
                                <Input name="q" defaultValue={filters.q ?? ''} className="w-56" />
                            </label>
                            <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                Agency
                                <Select name="agencyId" defaultValue={filters.agencyId ?? ''} className="w-44">
                                    <option value="">Every agency</option>
                                    {data.agencies.map((agency) => (
                                        <option key={agency.id} value={agency.id}>
                                            {agency.code}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                Posted to
                                <Select name="orgUnitId" defaultValue={filters.orgUnitId ?? ''} className="w-56">
                                    <option value="">Anywhere</option>
                                    {data.units.map((unit) => (
                                        <option key={unit.id} value={unit.id}>
                                            {unit.code} · {unit.name}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                Role
                                <Select name="role" defaultValue={filters.role ?? ''} className="w-44">
                                    <option value="">Every role</option>
                                    {ROLES.map((role) => (
                                        <option key={role} value={role}>
                                            {humanise(role)}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                Account
                                <Select name="active" defaultValue={filters.active ?? 'all'} className="w-40">
                                    <option value="all">Any</option>
                                    <option value="active">Active</option>
                                    <option value="inactive">Deactivated</option>
                                </Select>
                            </label>
                            <Button type="submit" variant="outline">
                                Filter
                            </Button>
                        </form>

                        <p className="text-[14.5px] text-ink-mid">
                            <span className="mono text-ink">{formatCount(data.total)}</span>{' '}
                            {data.total === 1 ? 'person' : 'people'}.
                        </p>

                        <RegisterFrame>
                            <RegisterTable caption="Staff, by agency and role">
                                <RegisterHead>
                                    <Th>Name</Th>
                                    <Th>Role</Th>
                                    <Th>Agency</Th>
                                    <Th>Posted to</Th>
                                    <Th align="right">Open requests</Th>
                                    <Th>Account</Th>
                                </RegisterHead>
                                <RegisterBody>
                                    {data.rows.length === 0 ? (
                                        <EmptyRow colSpan={6}>Nobody matches these filters.</EmptyRow>
                                    ) : (
                                        data.rows.map((row) => (
                                            <Tr key={row.id}>
                                                <Td>
                                                    <span className="flex flex-col">
                                                        <span className="inline-flex flex-wrap items-center gap-2">
                                                            <Link
                                                                href={`/admin/people/${row.id}`}
                                                                className="text-brand underline underline-offset-2"
                                                            >
                                                                {row.name}
                                                            </Link>
                                                            {row.isSynthetic && <Badge tone="new">synthetic</Badge>}
                                                        </span>
                                                        <span className="mono text-xs text-ink-soft">{row.email}</span>
                                                    </span>
                                                </Td>
                                                <Td>
                                                    {humanise(row.role)}
                                                </Td>
                                                <Td mono>{row.agency?.code ?? '—'}</Td>
                                                <Td>
                                                    {!row.posted
                                                        ? '—'
                                                        : row.postings.length === 0
                                                          ? <span className="text-wait">Not posted</span>
                                                          : row.postings.map((p) => (
                                                                <span key={p.id} className="block">
                                                                    <span className="mono">{p.orgUnit.code}</span>{' '}
                                                                    {p.orgUnit.name}
                                                                </span>
                                                            ))}
                                                </Td>
                                                <Td align="right" mono>
                                                    {row.role === 'OFFICER' ? formatCount(row.openAssigned) : '—'}
                                                </Td>
                                                <Td>
                                                    {row.isActive ? (
                                                        <Badge tone="done">Active</Badge>
                                                    ) : (
                                                        <Badge tone="stop">Deactivated</Badge>
                                                    )}
                                                </Td>
                                            </Tr>
                                        ))
                                    )}
                                </RegisterBody>
                            </RegisterTable>
                        </RegisterFrame>
                        {data.total > data.pageSize && (
                            <Pagination
                                page={data.page}
                                pageSize={data.pageSize}
                                total={data.total}
                                hrefForPage={(next: number) => `/admin/people${toQuery({ ...filters, page: next })}`}
                            />
                        )}
                    </>
                )
            )}
        </PageShell>
    )
}
