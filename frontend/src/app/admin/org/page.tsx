import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import type { Department, OrgChart } from '@/types'
import { OrgChartClient } from './client'

export const metadata: Metadata = { title: 'Org chart · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * Who holds which post, tier by tier.
 *
 * Answers "who is responsible for Sector 5 sanitation?" without anyone having
 * to ask around — and makes a vacancy visible, which is usually the reason a
 * complaint sits unactioned.
 */
export default async function OrgChartPage({ searchParams }: { searchParams?: { dept?: string } }) {
    await requireUser('CIRCLE_OFFICER')

    const departments = (await serverFetchOr<Department[]>('/departments', [])).filter(
        (d) => d.status === 'ACTIVE',
    )

    if (departments.length === 0) {
        return (
            <div>
                <PageHeader title="Organisation chart" />
                <EmptyState title="No active departments" />
            </div>
        )
    }

    const selectedId = Number(searchParams?.dept ?? departments[0]!.id)
    const chart = await serverFetchOr<OrgChart | null>(`/departments/${selectedId}/chart`, null)

    return (
        <div>
            <PageHeader
                title="Organisation chart"
                description="The chain of command a complaint travels up when it is not resolved in time."
            />
            <OrgChartClient departments={departments} selectedId={selectedId} chart={chart} />
        </div>
    )
}
