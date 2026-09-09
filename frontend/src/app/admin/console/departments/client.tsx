'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Count, DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { Toolbar } from '@/components/console/toolbar'
import type { Department } from '@/types'
import { DepartmentEditor } from '../editors'

export function DepartmentsClient({ departments }: { departments: Department[] }) {
    const router = useRouter()
    const [search, setSearch] = useState('')
    const [creating, setCreating] = useState(false)

    const columns: Column<Department>[] = [
        {
            key: 'name',
            header: 'Department',
            value: (d) => `${d.name} ${d.code}`,
            cell: (d) => (
                <div className="flex items-center gap-2.5">
                    <span aria-hidden className="text-base">
                        {d.icon}
                    </span>
                    <RowTitle hint={d.nameHi ?? d.code}>{d.name}</RowTitle>
                </div>
            ),
        },
        {
            key: 'code',
            header: 'Code',
            width: 'w-24',
            secondary: true,
            value: (d) => d.code,
            cell: (d) => <Mono>{d.code}</Mono>,
        },
        {
            key: 'status',
            header: 'Status',
            value: (d) => d.status,
            cell: (d) =>
                d.status === 'ACTIVE' ? (
                    <Badge variant="success">Live</Badge>
                ) : (
                    <Badge variant="neutral">On the roadmap</Badge>
                ),
        },
        {
            key: 'staff',
            header: 'Staff',
            align: 'right',
            value: (d) => d._count?.postings ?? 0,
            cell: (d) => <Count value={d._count?.postings ?? 0} />,
        },
        {
            key: 'categories',
            header: 'Categories',
            align: 'right',
            secondary: true,
            value: (d) => d._count?.categories ?? 0,
            cell: (d) => <Count value={d._count?.categories ?? 0} />,
        },
        {
            key: 'complaints',
            header: 'Complaints',
            align: 'right',
            value: (d) => d._count?.complaints ?? 0,
            cell: (d) => <Count value={d._count?.complaints ?? 0} />,
        },
    ]

    return (
        <div>
            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search departments"
                actions={
                    <Button size="sm" onClick={() => setCreating(true)}>
                        <Plus />
                        New department
                    </Button>
                }
            />

            <DataTable
                rows={departments}
                columns={columns}
                getRowId={(d) => d.id}
                search={search}
                linkFor={(d) => `/admin/console/departments/${d.id}`}
                rowTone={(d) =>
                    d.status === 'ACTIVE' && (d._count?.postings ?? 0) === 0 ? 'danger' : null
                }
                footnote="A department cannot go live until at least one Section Officer is posted to it — red rows are live with nobody in them."
            />

            {creating && (
                <DepartmentEditor
                    department={null}
                    onClose={() => setCreating(false)}
                    onSaved={() => {
                        setCreating(false)
                        router.refresh()
                    }}
                />
            )}
        </div>
    )
}
