import type { Metadata } from 'next'
import Link from 'next/link'
import { CirclePlus } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import type { CommunityFeed } from '@/types'
import { CommunityClient } from './client'
import { NeedsHomeSector } from '../needs-home-sector'

export const metadata: Metadata = { title: 'My neighbourhood · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * The grievances your neighbours have raised.
 *
 * Its civic purpose is to turn a pile of duplicate complaints into one problem
 * with a number of people behind it. Twelve households reporting the same
 * choked drain gives an officer twelve things to close; one grievance backed by
 * eleven names gives them one thing they cannot ignore.
 */
export default async function CommunityPage({
    searchParams,
}: {
    searchParams?: { scope?: string }
}) {
    await requireUser()
    const scope = searchParams?.scope === 'unit' ? 'unit' : 'area'

    const feed = await serverFetchOr<CommunityFeed>(`/citizen/community?scope=${scope}`, {
        home: null,
        needsHomeSector: true,
        scope: 'area',
        items: [],
    })

    if (feed.needsHomeSector || !feed.home) {
        return (
            <div>
                <PageHeader
                    title="My neighbourhood"
                    description="Issues your neighbours have raised, and the ones you can put your name to."
                />
                <NeedsHomeSector what="the grievances raised near you" />
            </div>
        )
    }

    return (
        <div>
            <PageHeader
                title="My neighbourhood"
                description={`Open issues around ${feed.home.unitName}. Backing one tells the authority how many households it affects — and enough backing raises its priority.`}
                action={
                    <Button asChild>
                        <Link href="/complaints/new">
                            <CirclePlus />
                            Raise an issue
                        </Link>
                    </Button>
                }
            />
            <CommunityClient feed={feed} scope={scope} />
        </div>
    )
}
