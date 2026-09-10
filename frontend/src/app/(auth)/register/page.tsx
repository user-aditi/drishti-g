import type { Metadata } from 'next'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { getAreas } from '@/lib/api'
import { RegisterForm } from './client'
import type { Area } from '@/types'

export const metadata: Metadata = { title: 'Create an account' }

/**
 * The board list is public reference data, so the form can offer it before
 * anyone has an account. If the API is unreachable the field hides itself
 * rather than blocking registration — a home board is a convenience for the
 * intake form, not a requirement for having an account.
 */
export default async function RegisterPage() {
    let areas: Area[] = []
    try {
        areas = await getAreas()
    } catch {
        areas = []
    }

    return (
        <PageShell width="text">
            <PageHeading
                title="Create an account"
                description="An account keeps a list of the requests you file here. Filing and checking a request both work without one."
            />
            <RegisterForm areas={areas} />
        </PageShell>
    )
}
