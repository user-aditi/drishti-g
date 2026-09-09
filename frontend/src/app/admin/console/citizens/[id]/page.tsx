import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { serverFetch } from '@/lib/api'
import { ApiError } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { RecordHeader, TableCaption, Trail } from '@/components/console/detail'
import { ComplaintsTable } from '@/components/console/tables'
import { OPEN_STATUSES } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import type { CitizenFile } from '@/types'
import { Rating } from '../client'

export const metadata: Metadata = { title: 'Citizen · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function CitizenPage({ params }: { params: { id: string } }) {
    let file: CitizenFile
    try {
        file = await serverFetch<CitizenFile>(`/console/citizens/${params.id}`)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        throw err
    }

    const { citizen, complaints } = file
    const open = complaints.filter((c) => OPEN_STATUSES.includes(c.status)).length
    const overdue = complaints.filter((c) => c.isOverdue).length
    const rated = complaints.filter((c) => c.feedbackRating != null)
    const avgRating =
        rated.length > 0
            ? rated.reduce((sum, c) => sum + (c.feedbackRating ?? 0), 0) / rated.length
            : null

    return (
        <div>
            <Trail
                items={[
                    { label: 'Citizens', href: '/admin/console/citizens' },
                    { label: citizen.fullName },
                ]}
            />

            <RecordHeader
                title={citizen.fullName}
                subtitle={
                    <>
                        {citizen.email}
                        {citizen.phone ? ` · ${citizen.phone}` : ''}
                        {citizen.homeSector && (
                            <>
                                {' · '}
                                <Link
                                    href={`/admin/console/city/sectors/${citizen.homeSector.id}`}
                                    className="hover:underline"
                                >
                                    Sector {citizen.homeSector.number}
                                </Link>
                            </>
                        )}
                    </>
                }
                badges={!citizen.isActive ? <Badge variant="danger">Blocked</Badge> : undefined}
                stats={[
                    { label: 'Reported', value: complaints.length },
                    { label: 'Still open', value: open },
                    {
                        label: 'Past deadline',
                        value: overdue,
                        tone: overdue > 0 ? 'danger' : undefined,
                    },
                    {
                        label: 'How they rated us',
                        value: <Rating value={avgRating} />,
                    },
                    { label: 'Registered', value: formatDate(citizen.createdAt) },
                ]}
            />

            <TableCaption
                title="Everything they have reported"
                hint="A citizen with several overdue complaints is the clearest signal the authority is failing somebody in particular."
            />
            <ComplaintsTable
                complaints={complaints}
                emptyText="They have not reported anything yet."
            />
        </div>
    )
}
