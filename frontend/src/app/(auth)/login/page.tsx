import type { Metadata } from 'next'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { LoginForm } from './client'

export const metadata: Metadata = { title: 'Sign in' }

/**
 * Signing in is not needed to file or to check a request, and the page says so
 * first. An account exists for two reasons only: to keep a list of your own
 * requests, and to work an agency queue.
 */
export default function LoginPage() {
    return (
        <PageShell width="text">
            <PageHeading
                title="Sign in"
                description="You do not need an account to file a request or to check one — an SR number is enough. Signing in keeps a list of the requests you filed, and opens the agency queue for staff accounts."
            />
            <LoginForm />
        </PageShell>
    )
}
