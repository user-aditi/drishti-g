import type { Metadata } from 'next'
import { NotificationList } from '@/components/shared/notification-list'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { getNotifications } from '@/lib/api'
import { messageFrom } from '@/lib/api-error'
import { requireUser } from '@/lib/auth'
import type { NotificationsPage } from '@/types'

export const metadata: Metadata = { title: 'Notifications' }
export const dynamic = 'force-dynamic'

/**
 * What happened that you should know about.
 *
 * In-app only. An academic replica sends no email and no texts, and says so here
 * rather than letting someone wait for a message that will never come.
 */
export default async function NotificationsView() {
    await requireUser()

    let data: NotificationsPage | null = null
    let error: string | null = null
    try {
        data = await getNotifications()
    } catch (err) {
        error = messageFrom(err, 'Your notifications could not be loaded.')
    }

    return (
        <PageShell width="text">
            <PageHeading
                title="Notifications"
                description="Changes to requests you reported, and anything waiting on you. Shown here only — this replica sends no email or text messages."
            />
            {error ? (
                <ErrorNotice title="Could not load notifications" message={error} />
            ) : (
                data && <NotificationList initial={data} />
            )}
        </PageShell>
    )
}
