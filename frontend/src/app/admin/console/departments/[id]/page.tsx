import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { serverFetch } from '@/lib/api'
import { ApiError } from '@/lib/api-error'
import type { ConsoleComplaint, DepartmentDetail, Paged } from '@/types'
import { DepartmentClient } from './client'

export const metadata: Metadata = { title: 'Department · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function DepartmentPage({
    params,
    searchParams,
}: {
    params: { id: string }
    searchParams?: { tab?: string }
}) {
    const tab = searchParams?.tab ?? 'chain'

    let detail: DepartmentDetail
    try {
        detail = await serverFetch<DepartmentDetail>(`/console/departments/${params.id}/detail`)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        throw err
    }

    const complaints =
        tab === 'complaints'
            ? await serverFetch<Paged<ConsoleComplaint>>(
                  `/console/complaints?size=500&departmentId=${params.id}`,
              ).catch(() => ({ items: [], total: 0, page: 1, size: 500 }))
            : { items: [], total: 0, page: 1, size: 500 }

    return (
        <DepartmentClient
            detail={detail}
            tab={tab}
            complaints={complaints.items}
        />
    )
}
