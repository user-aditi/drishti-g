import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { Department } from '@/types'
import { DepartmentsAdminClient } from './client'

export const metadata: Metadata = { title: 'Departments · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function AdminDepartmentsPage() {
    await requireUser('CEO')
    const departments = await serverFetchOr<Department[]>('/departments', [])

    return (
        <div>
            <PageHeader
                title="Departments"
                description="Which wings are live, which are on the roadmap, and what each one is carrying."
            />
            <DepartmentsAdminClient departments={departments} />
        </div>
    )
}
