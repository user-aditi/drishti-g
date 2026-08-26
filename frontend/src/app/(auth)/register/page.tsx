import type { Metadata } from 'next'
import { serverFetchOr } from '@/lib/api'
import type { Sector } from '@/types'
import { RegisterClient } from './client'

export const metadata: Metadata = { title: 'Create an account · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
    // The sector list is public reference data, so the form can offer it before
    // anyone has an account. If the API is unreachable the field hides itself
    // rather than blocking registration.
    const sectors = await serverFetchOr<Sector[]>('/sectors', [])

    return <RegisterClient sectors={sectors} />
}
