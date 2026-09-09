import type { Metadata } from 'next'
import { serverFetchOr } from '@/lib/api'
import { Trail } from '@/components/console/detail'
import { PageHeader } from '@/components/shared/page-header'
import type { Department } from '@/types'
import { DepartmentsClient } from './client'

export const metadata: Metadata = { title: 'Departments · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function DepartmentsPage() {
    const departments = await serverFetchOr<Department[]>('/departments', [])

    return (
        <div>
            <Trail items={[{ label: 'Departments' }]} />
            <PageHeader
                title="Departments"
                description="Each department has its own chain of command, its own titles for each rank, and its own list of what the public may report to it. Open one to see all three together."
            />
            <DepartmentsClient departments={departments} />
        </div>
    )
}
