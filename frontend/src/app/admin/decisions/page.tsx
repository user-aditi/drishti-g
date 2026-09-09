import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { DecisionRow, DecisionAgreement } from '@/types'
import { DecisionsClient } from './client'

export const metadata: Metadata = { title: 'Decisions · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * What the engines judged, and whether anyone disagreed.
 *
 * GCCE has always explained itself — every complaint's timeline carries the
 * sentence it wrote about why it went where it did. What that sentence cannot
 * answer is the question this screen exists for: *how often is it wrong?* One
 * routing decision reads as reasonable whatever it says; ten thousand of them,
 * with the corrections attached, say whether the engine can be trusted with
 * more autonomy or less.
 *
 * That makes this the screen the autonomy gate is argued from in wave 4, and
 * the source of the labels its models train on.
 */
export default async function DecisionsPage({
    searchParams,
}: {
    searchParams?: { kind?: string; outcome?: string; page?: string }
}) {
    await requireUser('SUPER_ADMIN')

    const page = Number(searchParams?.page ?? 1)
    const params = new URLSearchParams({ page: String(page), size: '50' })
    if (searchParams?.kind) params.set('kind', searchParams.kind)
    if (searchParams?.outcome) params.set('outcome', searchParams.outcome)

    const result = await serverFetchOr<{
        items: DecisionRow[]
        total: number
        page: number
        size: number
        agreement: DecisionAgreement[]
    }>(`/console/decisions?${params}`, {
        items: [],
        total: 0,
        page,
        size: 50,
        agreement: [],
    })

    return (
        <div>
            <PageHeader
                title="Decisions"
                description="Every judgement GCCE made, what it nearly chose instead, and what happened when someone looked at it."
            />
            <DecisionsClient
                result={result}
                kind={searchParams?.kind ?? ''}
                outcome={searchParams?.outcome ?? ''}
            />
        </div>
    )
}
