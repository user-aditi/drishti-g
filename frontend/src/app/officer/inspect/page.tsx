import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { VerificationQueueItem } from '@/types'
import { VerificationQueueClient } from './client'

export const metadata: Metadata = { title: 'Needs your decision · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * The jobs neither the pipeline nor the resident could settle.
 *
 * This page used to list everything awaiting inspection, which meant every
 * closure in the sector passed across the officer's desk — the bottleneck that
 * makes municipal systems silt up. Now the automated checks refuse recycled or
 * stale proof outright, the resident who reported the problem settles most of
 * the rest, and only two kinds of case reach here: one a resident actively
 * disputed, and one where weak proof went unanswered for two days.
 *
 * If this queue is long, something upstream is wrong. That is the intent.
 */
export default async function OfficerInspectPage() {
    const user = await requireUser('SECTION_OFFICER')

    const queue = await serverFetchOr<{ items: VerificationQueueItem[]; total: number }>(
        '/crew/verification-queue',
        { items: [], total: 0 },
    )

    const posting = user.primaryPosting
    const description = posting
        ? [
              posting.designationTitle,
              posting.sector && `Sector ${posting.sector.number}`,
              posting.department?.name,
          ]
              .filter(Boolean)
              .join(' · ')
        : undefined

    return (
        <div>
            <PageHeader
                title="Needs your decision"
                description={description}
            />
            <VerificationQueueClient items={queue.items} />
        </div>
    )
}
