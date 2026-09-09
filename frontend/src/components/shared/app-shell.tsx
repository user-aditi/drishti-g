import type { ReactNode } from 'react'
import { AppSidebar } from './app-sidebar'
import { AppTopbar } from './app-topbar'
import { navFor, postingLine } from './app-nav'
import type { User } from '@/types'

/**
 * The chrome around every signed-in screen.
 *
 * Rendered from a server layout, so the navigation is already correct in the
 * first HTML the browser receives rather than appearing after a session check.
 */
export function AppShell({ user, children }: { user: User; children: ReactNode }) {
    return (
        <div className="min-h-screen lg:flex">
            <AppSidebar
                items={navFor(user)}
                userName={user.fullName}
                postingLine={postingLine(user)}
                departmentName={user.primaryPosting?.department?.name ?? null}
                departmentIcon={user.primaryPosting?.department?.icon ?? null}
            />

            <div className="flex min-w-0 flex-1 flex-col">
                <AppTopbar />
                <main id="main-content" className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
                    <div className="mx-auto w-full max-w-7xl">{children}</div>
                </main>
            </div>
        </div>
    )
}
