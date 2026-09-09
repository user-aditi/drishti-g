import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { CrewRow } from '@/types'
import { CrewClient } from './client'

export const metadata: Metadata = { title: 'My crew · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * Who works this officer's sector.
 *
 * Not user accounts — a name, a phone and a trade. Municipal street labour is
 * largely contractual and rotates, so the roll is a note about who is working
 * for you this week, and jobs reach them by code rather than by login.
 *
 * Readable by every rank above Section Officer too, scoped to their
 * jurisdiction, which is what makes "how many sweepers do we have in Zone II"
 * answerable without counting accounts that were never real.
 */
export default async function OfficerCrewPage() {
    const user = await requireUser('SECTION_OFFICER')

    const roll = await serverFetchOr<{ items: CrewRow[]; canManage: boolean }>('/crew', {
        items: [],
        canManage: false,
    })

    const posting = user.primaryPosting

    return (
        <div>
            <PageHeader
                title="My crew"
                description={
                    roll.canManage
                        ? 'The people who work your sector. They have no login — you hand them a job and they get a code.'
                        : 'The crew working under you, across your jurisdiction.'
                }
            />
            <CrewClient
                crew={roll.items}
                canManage={roll.canManage}
                defaultSectorId={posting?.sector?.id ?? null}
                defaultDepartmentId={posting?.department?.id ?? null}
            />
        </div>
    )
}
