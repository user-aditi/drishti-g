import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import type { Category } from '@/types'
import { NewComplaintClient } from './client'

export const metadata: Metadata = { title: 'Report an issue · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function NewComplaintPage() {
    await requireUser()

    // Only categories belonging to a live department come back, so a citizen is
    // never offered one that cannot be acted on.
    const categories = await serverFetchOr<Category[]>('/categories', [])

    return <NewComplaintClient categories={categories} />
}
