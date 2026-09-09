import type { Metadata } from 'next'
import { CircleCheck } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import { isAuthorityWide } from '@/lib/constants'
import type { EscalationInboxItem } from '@/types'
import { EscalationsClient } from './client'

export const metadata: Metadata = { title: 'Escalated to me · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * Complaints that became this officer's problem because someone below them
 * missed a deadline.
 *
 * This queue is the point of having a hierarchy at all — without it an
 * unresolved complaint sits where it was first assigned and nobody senior ever
 * learns it is stuck.
 */
export default async function EscalationsPage() {
    const user = await requireUser('CIRCLE_OFFICER')
    const inbox = await serverFetchOr<{ items: EscalationInboxItem[]; total: number }>(
        '/admin/escalations',
        { items: [], total: 0 },
    )

    return (
        <div>
            <PageHeader
                title="Escalated to me"
                description="Complaints that missed their deadline further down the chain and are now your responsibility."
            />

            {inbox.items.length === 0 ? (
                <EmptyState
                    icon={<CircleCheck className="h-6 w-6" />}
                    title="Nothing escalated to you"
                    description="When a complaint below you passes its deadline it lands here with the reason."
                />
            ) : (
                <EscalationsClient items={inbox.items} canSweep={isAuthorityWide(user.rank)} />
            )}
        </div>
    )
}
