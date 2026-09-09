import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { serverFetch } from '@/lib/api'
import { ApiError } from '@/lib/api-error'
import { PageHeader } from '@/components/shared/page-header'
import { Trail } from '@/components/console/detail'
import type { DepartmentLayersResponse } from '@/types'
import { LayersClient } from './client'

export const metadata: Metadata = { title: 'Layers · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * How deep a department runs.
 *
 * The one screen where the shape of the chain of command is a decision rather
 * than a fact of the schema. A department may work the full depth of the city
 * or stop higher up; what it cannot do is skip a layer, or dispatch work from
 * anywhere but the floor nearest the citizen.
 */
export default async function LayersPage({ params }: { params: { id: string } }) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) notFound()

    let data: DepartmentLayersResponse
    try {
        data = await serverFetch<DepartmentLayersResponse>(`/console/departments/${id}/layers`)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        throw err
    }

    return (
        <div>
            <Trail
                items={[
                    { label: 'Departments', href: '/admin/console/departments' },
                    { label: data.department.name, href: `/admin/console/departments/${id}` },
                    { label: 'Layers' },
                ]}
            />
            <PageHeader
                title={`${data.department.name} — layers`}
                description="How many levels this department works through, and how long a complaint may sit at each before it climbs. Every department shares the same map of the city; this decides how far down this one reaches."
            />
            <LayersClient data={data} />
        </div>
    )
}
