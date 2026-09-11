import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LayerMark } from '@/components/layer1/marks'
import { VerifyChainButton } from '@/components/layer3/admin-actions'
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
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { messageFrom } from '@/lib/api-error'
import { toQuery } from '@/lib/api-base'
import { homeFor, requireUser } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import { getAdminAudit } from '@/lib/layer3-server'
import type { AuditPage } from '@/types/layer3'

export const metadata: Metadata = { title: 'Audit chain' }
export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined

/**
 * The audit chain, newest first, with a check anyone at this desk can run.
 *
 * What the chain does not contain matters as much as what it does. NYC's
 * 355,430 requests appear as import batches and nothing else — no invented
 * "assigned" or "closed" events — so every other entry here is something this
 * system did.
 */
export default async function AuditPageView({
    searchParams,
}: {
    searchParams: Record<string, string | string[] | undefined>
}) {
    const user = await requireUser()
    if (user.role !== 'ADMIN') redirect(homeFor(user.role))

    const page = Math.max(1, Number(one(searchParams.page)) || 1)
    const action = one(searchParams.action)

    let data: AuditPage | null = null
    let error: string | null = null
    try {
        data = await getAdminAudit({ page, action })
    } catch (err) {
        error = messageFrom(err, 'The audit chain could not be loaded.')
    }

    return (
        <PageShell>
            <PageHeading
                title="Audit chain"
                actions={<LayerMark layer={3} />}
                description="Every action this system has taken, each entry hashed together with the one before it, so that removing, reordering or editing any of them breaks the chain from that point on."
            />
            <VerifyChainButton />
            {error ? (
                <ErrorNotice title="Could not load the audit chain" message={error} />
            ) : (
                data && (
                    <>
                        <form className="flex flex-wrap items-end gap-3" method="get">
                            <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                Action
                                <Select name="action" defaultValue={action ?? ''} className="w-64">
                                    <option value="">Every action</option>
                                    {data.actions.map((a) => (
                                        <option key={a.action} value={a.action}>
                                            {a.action} · {a.count.toLocaleString('en-US')}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <Button type="submit" variant="outline">
                                Show
                            </Button>
                        </form>
                        <RegisterFrame>
                            <RegisterTable caption="Audit entries, newest first">
                                <RegisterHead>
                                    <Th align="right">#</Th>
                                    <Th>Recorded</Th>
                                    <Th>Action</Th>
                                    <Th>Entity</Th>
                                    <Th>By</Th>
                                    <Th>Source</Th>
                                    <Th>Hash</Th>
                                </RegisterHead>
                                <RegisterBody>
                                    {data.rows.length === 0 ? (
                                        <EmptyRow colSpan={7}>No entries.</EmptyRow>
                                    ) : (
                                        data.rows.map((row) => (
                                            <Tr key={row.id}>
                                                <Td mono align="right">
                                                    {row.id}
                                                </Td>
                                                <Td mono className="whitespace-nowrap">
                                                    {formatDateTime(row.createdAt)}
                                                </Td>
                                                <Td mono>{row.action}</Td>
                                                <Td mono className="text-sm">
                                                    {row.entityType} {String(row.entityId)}
                                                </Td>
                                                <Td className="text-sm">{row.actorLabel ?? '—'}</Td>
                                                <Td mono className="text-sm">
                                                    {row.source}
                                                </Td>
                                                <Td mono className="text-sm text-ink-soft">
                                                    {row.hash.slice(0, 12)}
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
                                hrefForPage={(next: number) => `/admin/audit${toQuery({ page: next, action })}`}
                            />
                        )}
                    </>
                )
            )}
        </PageShell>
    )
}
