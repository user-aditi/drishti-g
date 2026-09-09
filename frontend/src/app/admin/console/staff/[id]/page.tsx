import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { serverFetch, serverFetchOr } from '@/lib/api'
import { ApiError } from '@/lib/api-error'
import type { Department, GeographyTree, StaffFile } from '@/types'
import { StaffFileClient } from './client'

export const metadata: Metadata = { title: 'Service record · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function StaffMemberPage({
    params,
    searchParams,
}: {
    params: { id: string }
    searchParams?: { tab?: string }
}) {
    let file: StaffFile
    try {
        file = await serverFetch<StaffFile>(`/console/staff/${params.id}`)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        throw err
    }

    const [departments, geography] = await Promise.all([
        serverFetchOr<Department[]>('/departments', []),
        serverFetchOr<GeographyTree[]>('/geography', []),
    ])

    return (
        <StaffFileClient
            file={file}
            tab={searchParams?.tab ?? 'charge'}
            departments={departments}
            geography={geography}
        />
    )
}
