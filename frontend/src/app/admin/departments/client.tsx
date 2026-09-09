'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Count, DataTable, RowTitle, type Column } from '@/components/shared/data-table'
import { Toolbar } from '@/components/shared/controls'
import { ErrorBanner } from '@/components/shared/page-header'
import type { Department } from '@/types'

/**
 * The department register.
 *
 * This was a grid of cards, which made the one question the page exists to
 * answer — *which departments can actually take a complaint, and are they
 * staffed enough to* — into a scavenger hunt across nine tiles. As a register
 * the answer reads straight down two columns, live and planned departments sort
 * against each other, and the staff count that decides whether a department can
 * go live sits next to the switch that puts it live.
 */
export function DepartmentsAdminClient({ departments }: { departments: Department[] }) {
    const router = useRouter()
    const [busyId, setBusyId] = useState<number | null>(null)
    const [search, setSearch] = useState('')
    const [error, setError] = useState<string | null>(null)

    async function toggleStatus(dept: Department) {
        setBusyId(dept.id)
        setError(null)
        try {
            await apiClient.updateDepartment(dept.id, {
                status: dept.status === 'ACTIVE' ? 'COMING_SOON' : 'ACTIVE',
            })
            router.refresh()
        } catch (err) {
            // The API refuses to activate a department with no Section Officer
            // posted, because its complaints would route to nobody. Surface that
            // reason rather than a generic failure.
            setError(messageFrom(err, 'Could not update that department.'))
        } finally {
            setBusyId(null)
        }
    }

    const columns: Column<Department>[] = [
        {
            key: 'name',
            header: 'Department',
            value: (d) => `${d.name} ${d.nameHi ?? ''} ${d.description ?? ''}`,
            cell: (d) => (
                <div className="flex items-start gap-3">
                    <span
                        aria-hidden
                        className={d.status === 'ACTIVE' ? 'text-xl' : 'text-xl opacity-50'}
                    >
                        {d.icon}
                    </span>
                    <RowTitle hint={d.nameHi ?? undefined}>{d.name}</RowTitle>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'w-32',
            value: (d) => (d.status === 'ACTIVE' ? 'Live' : 'Coming soon'),
            cell: (d) =>
                d.status === 'ACTIVE' ? (
                    <Badge variant="success">Live</Badge>
                ) : (
                    <Badge variant="neutral">Coming soon</Badge>
                ),
        },
        {
            key: 'scope',
            header: 'What it covers',
            secondary: true,
            value: (d) => d.description ?? null,
            cell: (d) => (
                <p className="line-clamp-2 max-w-md text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                    {d.status === 'ACTIVE' ? d.description : (d.roadmapNote ?? d.description)}
                </p>
            ),
        },
        {
            key: 'categories',
            header: 'Issue types',
            align: 'right',
            secondary: true,
            value: (d) => d._count?.categories ?? 0,
            cell: (d) => <Count value={d._count?.categories ?? 0} />,
        },
        {
            key: 'postings',
            header: 'Staff',
            align: 'right',
            value: (d) => d._count?.postings ?? 0,
            cell: (d) => {
                const posted = d._count?.postings ?? 0
                // A live department with nobody in it routes complaints to
                // nobody, which is the failure this register exists to catch.
                return posted === 0 && d.status === 'ACTIVE' ? (
                    <Badge variant="danger">Nobody</Badge>
                ) : (
                    <Count value={posted} />
                )
            },
        },
        {
            key: 'complaints',
            header: 'Complaints',
            align: 'right',
            value: (d) => d._count?.complaints ?? 0,
            cell: (d) => <Count value={d._count?.complaints ?? 0} />,
        },
        {
            key: 'actions',
            header: '',
            width: 'w-32',
            align: 'right',
            cell: (d) => (
                <Button
                    size="sm"
                    variant={d.status === 'ACTIVE' ? 'outline' : 'default'}
                    onClick={() => void toggleStatus(d)}
                    disabled={busyId === d.id}
                >
                    {busyId === d.id && <Loader2 className="animate-spin" />}
                    {d.status === 'ACTIVE' ? 'Take offline' : 'Make live'}
                </Button>
            ),
        },
    ]

    return (
        <div>
            {error && <ErrorBanner message={error} />}

            <Toolbar search={search} onSearch={setSearch} placeholder="Search departments" />

            <DataTable
                rows={departments}
                columns={columns}
                getRowId={(d) => d.id}
                search={search}
                initialSort={{ key: 'status', direction: 'asc' }}
                rowTone={(d) => (d.status === 'ACTIVE' ? null : 'muted')}
                empty="No departments are configured."
                footnote="Dimmed rows are on the roadmap and are not accepting complaints yet."
            />
        </div>
    )
}
