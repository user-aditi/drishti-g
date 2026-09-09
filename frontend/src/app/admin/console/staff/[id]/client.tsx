'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2, Repeat, UserPlus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/shared/page-header'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { NothingHere, RecordHeader, RecordTabs, TableCaption, Trail } from '@/components/console/detail'
import { PRIORITY_META, RANK_LABEL, RANK_STYLE, STATUS_META, TRADE_LABEL } from '@/lib/constants'
import { formatDate, initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Complaint, Department, GeographyTree, Posting, StaffFile } from '@/types'
import { PasswordDrawer, PostingActionDrawer } from '../appoint'

type PostingRow = Posting & { startedAt: string; endedAt: string | null }
type Action = 'transfer' | 'charge' | 'password' | null

/** Where a posting sits, spelled out. */
function whereOf(p: Posting): string {
    if (p.sector) return `Sector ${p.sector.number}`
    return p.circle?.name ?? p.zone?.name ?? 'Authority-wide'
}

/** A link to the patch a posting covers, so a record connects back to the city. */
function whereLink(p: Posting): string | null {
    if (p.sector) return `/admin/console/city/sectors/${p.sector.id}`
    if (p.circle) return `/admin/console/city/circles/${p.circle.id}`
    if (p.zone) return `/admin/console/city/zones/${p.zone.id}`
    return null
}

export function StaffFileClient({
    file,
    tab,
    departments,
    geography,
}: {
    file: StaffFile
    tab: string
    departments: Department[]
    geography: GeographyTree[]
}) {
    const router = useRouter()
    const [action, setAction] = useState<Action>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const base = `/admin/console/staff/${file.id}`
    const current = file.postingHistory.filter((p) => p.endedAt === null)
    const past = file.postingHistory.filter((p) => p.endedAt !== null)

    async function toggleActive() {
        setBusy(true)
        setError(null)
        try {
            await apiClient.updateUser(file.id, { isActive: !file.isActive })
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not update this account.'))
        } finally {
            setBusy(false)
        }
    }

    async function endPosting(postingId: number) {
        setBusy(true)
        setError(null)
        try {
            await apiClient.console.staff.endPosting(postingId)
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not end this posting.'))
        } finally {
            setBusy(false)
        }
    }

    const currentColumns: Column<PostingRow>[] = [
        {
            key: 'post',
            header: 'Post',
            value: (p) => p.designationTitle ?? RANK_LABEL[p.rank],
            cell: (p) => (
                <RowTitle
                    hint={[p.department?.name, p.trade ? TRADE_LABEL[p.trade] : null]
                        .filter(Boolean)
                        .join(' · ')}
                >
                    {p.designationTitle ?? RANK_LABEL[p.rank]}
                </RowTitle>
            ),
        },
        {
            key: 'where',
            header: 'Charge',
            value: (p) => whereOf(p),
            cell: (p) => {
                const href = whereLink(p)
                return href ? (
                    <Link href={href} className="text-xs hover:underline">
                        {whereOf(p)}
                    </Link>
                ) : (
                    <span className="text-xs">{whereOf(p)}</span>
                )
            },
        },
        {
            key: 'primary',
            header: 'Primary',
            value: (p) => (p.isPrimary ? 'Yes' : 'No'),
            cell: (p) =>
                p.isPrimary ? <Badge variant="info">Primary</Badge> : <span className="opacity-40">—</span>,
        },
        {
            key: 'since',
            header: 'Since',
            align: 'right',
            value: (p) => new Date(p.startedAt).getTime(),
            cell: (p) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {formatDate(p.startedAt)}
                </span>
            ),
        },
        {
            key: 'end',
            header: '',
            width: 'w-20',
            align: 'right',
            cell: (p) =>
                current.length > 1 ? (
                    <button
                        onClick={() => void endPosting(p.id)}
                        disabled={busy}
                        className="text-xs font-medium text-[color:var(--error)] hover:underline disabled:opacity-50"
                    >
                        End
                    </button>
                ) : null,
        },
    ]

    const workColumns: Column<Complaint>[] = [
        {
            key: 'ref',
            header: 'Reference',
            width: 'w-36',
            value: (c) => c.referenceNo,
            cell: (c) => <Mono>{c.referenceNo}</Mono>,
        },
        {
            key: 'title',
            header: 'Complaint',
            value: (c) => c.title,
            cell: (c) => (
                <RowTitle hint={c.sector ? `Sector ${c.sector.number}` : undefined}>{c.title}</RowTitle>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            value: (c) => STATUS_META[c.status].label,
            cell: (c) => (
                <Badge className={STATUS_META[c.status].className}>{STATUS_META[c.status].label}</Badge>
            ),
        },
        {
            key: 'priority',
            header: 'Priority',
            secondary: true,
            value: (c) => c.priority,
            cell: (c) => (
                <Badge className={PRIORITY_META[c.priority].className}>
                    {PRIORITY_META[c.priority].label}
                </Badge>
            ),
        },
        {
            key: 'updated',
            header: 'Last moved',
            align: 'right',
            value: (c) => new Date(c.updatedAt).getTime(),
            cell: (c) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {formatDate(c.updatedAt)}
                </span>
            ),
        },
    ]

    const primary = file.primaryPosting

    return (
        <div>
            <Trail
                items={[
                    { label: 'Officers & staff', href: '/admin/console/staff' },
                    { label: file.fullName },
                ]}
            />

            {error && <ErrorBanner message={error} />}

            <RecordHeader
                icon={
                    <span
                        className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold',
                            file.isActive
                                ? 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]'
                                : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
                        )}
                    >
                        {initials(file.fullName)}
                    </span>
                }
                title={file.fullName}
                subtitle={
                    <>
                        {file.email}
                        {file.phone ? ` · ${file.phone}` : ''}
                        {primary?.department ? ` · ${primary.department.name}` : ''}
                    </>
                }
                badges={
                    <>
                        <Badge className={RANK_STYLE[file.rank]}>
                            {primary?.designationTitle ?? file.rankLabel}
                        </Badge>
                        {!file.isActive && <Badge variant="danger">Deactivated</Badge>}
                    </>
                }
                actions={
                    <>
                        <Button size="sm" onClick={() => setAction('transfer')} disabled={busy}>
                            <Repeat />
                            Transfer
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAction('charge')}
                            disabled={busy}
                        >
                            <UserPlus />
                            Add charge
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAction('password')}
                            disabled={busy}
                        >
                            <KeyRound />
                            Reset password
                        </Button>
                        <Button
                            size="sm"
                            variant={file.isActive ? 'ghost' : 'success'}
                            className={file.isActive ? 'text-[color:var(--error)]' : undefined}
                            onClick={() => void toggleActive()}
                            disabled={busy}
                        >
                            {busy && <Loader2 className="animate-spin" />}
                            {file.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                    </>
                }
                stats={[
                    {
                        label: 'Open cases owned',
                        value: file.openCases,
                        tone: file.openCases >= 8 ? 'danger' : undefined,
                    },
                    { label: 'Open jobs allotted', value: file.openJobs },
                    { label: 'Charges held', value: current.length },
                    { label: 'Past postings', value: past.length },
                    { label: 'On the rolls since', value: formatDate(file.createdAt) },
                ]}
            />

            <RecordTabs
                basePath={base}
                active={tab}
                tabs={[
                    { key: 'charge', label: 'Charge & service record' },
                    { key: 'work', label: 'Recent work', count: file.recentWork.length },
                ]}
            />

            {tab === 'charge' && (
                <div className="space-y-8">
                    <section>
                        <TableCaption
                            title="Current charge"
                            hint="More than one means they are covering a second post as well. Both stay live for routing."
                        />
                        <DataTable
                            rows={current}
                            columns={currentColumns}
                            getRowId={(p) => p.id}
                            empty="No live posting — this person receives no work."
                            footnote={
                                current.length === 1
                                    ? 'Their only posting. Transfer them to end it — nobody should be left on the rolls without a post.'
                                    : undefined
                            }
                        />
                    </section>

                    <section>
                        <TableCaption
                            title="Service record"
                            hint="Ended postings are kept rather than deleted — this is what an audit asks for."
                        />
                        {past.length === 0 ? (
                            <NothingHere>
                                They have held no other post. Their history begins with the charge
                                above.
                            </NothingHere>
                        ) : (
                            <DataTable
                                rows={past}
                                columns={[
                                    currentColumns[0]!,
                                    currentColumns[1]!,
                                    {
                                        key: 'from',
                                        header: 'From',
                                        align: 'right',
                                        value: (p: PostingRow) => new Date(p.startedAt).getTime(),
                                        cell: (p: PostingRow) => (
                                            <span className="text-xs">{formatDate(p.startedAt)}</span>
                                        ),
                                    },
                                    {
                                        key: 'until',
                                        header: 'Until',
                                        align: 'right',
                                        value: (p: PostingRow) =>
                                            p.endedAt ? new Date(p.endedAt).getTime() : null,
                                        cell: (p: PostingRow) => (
                                            <span className="text-xs">{formatDate(p.endedAt)}</span>
                                        ),
                                    },
                                ]}
                                getRowId={(p) => p.id}
                                initialSort={{ key: 'until', direction: 'desc' }}
                            />
                        )}
                    </section>
                </div>
            )}

            {tab === 'work' && (
                <section>
                    <TableCaption
                        title="What has passed through their hands lately"
                        hint="Complaints they own, jobs they were allotted, or issues they filed themselves."
                    />
                    {file.recentWork.length === 0 ? (
                        <NothingHere>Nothing has been assigned to them yet.</NothingHere>
                    ) : (
                        <DataTable
                            rows={file.recentWork}
                            columns={workColumns}
                            getRowId={(c) => c.id}
                            initialSort={{ key: 'updated', direction: 'desc' }}
                        />
                    )}
                </section>
            )}

            {action === 'transfer' && (
                <PostingActionDrawer
                    mode="transfer"
                    person={file}
                    departments={departments}
                    geography={geography}
                    onClose={() => setAction(null)}
                    onSaved={() => {
                        setAction(null)
                        router.refresh()
                    }}
                />
            )}

            {action === 'charge' && (
                <PostingActionDrawer
                    mode="charge"
                    person={file}
                    departments={departments}
                    geography={geography}
                    onClose={() => setAction(null)}
                    onSaved={() => {
                        setAction(null)
                        router.refresh()
                    }}
                />
            )}

            {action === 'password' && (
                <PasswordDrawer person={file} onClose={() => setAction(null)} />
            )}
        </div>
    )
}
