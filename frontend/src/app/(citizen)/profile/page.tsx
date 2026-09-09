import type { Metadata } from 'next'
import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { CitizenContacts, CitizenProfile, Area } from '@/types'
import { ProfileClient } from './client'

export const metadata: Metadata = { title: 'My profile · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
    const user = await requireUser()

    const [profile, areas, contacts] = await Promise.all([
        serverFetchOr<CitizenProfile | null>('/citizen/profile', null),
        serverFetchOr<Area[]>('/areas', []),
        serverFetchOr<CitizenContacts>('/citizen/officers', {
            home: null,
            needsHomeSector: true,
            departments: [],
        }),
    ])

    if (!profile) {
        return (
            <div>
                <PageHeader title="My profile" />
                <p className="text-sm text-[color:var(--muted-foreground)]">
                    Could not load your profile just now.{' '}
                    <Link href="/dashboard" className="text-[color:var(--primary)] hover:underline">
                        Go back
                    </Link>
                    .
                </p>
            </div>
        )
    }

    return (
        <div>
            <PageHeader
                title="My profile"
                description="Your details, the sector you live in, and the officers who answer for it."
            />
            <ProfileClient
                profile={profile}
                areas={areas}
                contacts={contacts}
                currentName={user.fullName}
            />
        </div>
    )
}
