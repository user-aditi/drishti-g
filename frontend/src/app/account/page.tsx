import type { Metadata } from 'next'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { getAreas } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import type { Area } from '@/types'
import { PasswordForm, ProfileForm } from './forms'

export const metadata: Metadata = { title: 'Your account' }
export const dynamic = 'force-dynamic'

/**
 * Your own details and password. Anyone signed in.
 *
 * Email is shown and not editable: it is the sign-in identity, and changing it
 * safely would need a confirmation message this replica has no business sending.
 */
export default async function AccountPage() {
    const user = await requireUser()
    let areas: Area[] = []
    try {
        areas = await getAreas()
    } catch {
        areas = []
    }

    return (
        <PageShell width="text">
            <PageHeading title="Your account" description={`Signed in as ${user.email}.`} />
            <Panel>
                <PanelHeader>
                    <PanelTitle>Your details</PanelTitle>
                </PanelHeader>
                <PanelBody>
                    <ProfileForm
                        user={user}
                        areas={areas}
                        // A home board pre-fills filing, which staff do not do from here.
                        showHomeBoard={user.role === 'CITIZEN'}
                    />
                </PanelBody>
            </Panel>
            <Panel>
                <PanelHeader>
                    <PanelTitle>Change your password</PanelTitle>
                </PanelHeader>
                <PanelBody>
                    <PasswordForm />
                </PanelBody>
            </Panel>
        </PageShell>
    )
}
