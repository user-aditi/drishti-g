import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { AuditEvent, Paged } from '@/types'
import { AuditTrailClient } from './client'

export const metadata: Metadata = { title: 'Audit trail · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function AuditTrailPage({
    searchParams,
}: {
    searchParams?: { action?: string; page?: string }
}) {
    await requireUser('CEO')

    const page = Number(searchParams?.page ?? 1)
    const params = new URLSearchParams({ page: String(page), size: '25' })
    if (searchParams?.action) params.set('action', searchParams.action)

    const result = await serverFetchOr<Paged<AuditEvent>>(`/admin/audit?${params}`, {
        items: [],
        total: 0,
        page,
        size: 25,
    })

    return (
        <div>
            <PageHeader
                title="Audit trail"
                description="Every action the system took, in order, with a fingerprint linking each entry to the one before it."
            />
            <AuditTrailClient result={result} filter={searchParams?.action ?? ''} />
        </div>
    )
}
