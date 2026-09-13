'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ErrorNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { formatDateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AppNotification, NotificationsPage } from '@/types'

/**
 * A person's notifications, newest first, unread ones marked.
 *
 * Opening one marks it read and goes where it points; "mark all read" is there
 * for the person who has seen them all in the list and does not need to open
 * each. The header count is refreshed after either.
 */
export function NotificationList({ initial }: { initial: NotificationsPage }) {
    const router = useRouter()
    const [, startTransition] = useTransition()
    const [rows, setRows] = useState<AppNotification[]>(initial.rows)
    const [error, setError] = useState<string | null>(null)
    const unread = rows.filter((row) => row.readAt === null).length

    async function open(row: AppNotification) {
        if (row.readAt === null) {
            setRows((current) => current.map((r) => (r.id === row.id ? { ...r, readAt: new Date().toISOString() } : r)))
            try {
                await apiClient.markRead(row.id)
            } catch {
                // Still take them where they meant to go; the dot comes back next load.
            }
        }
        startTransition(() => router.push(row.href ?? '/notifications'))
        router.refresh()
    }

    async function markAll() {
        setError(null)
        try {
            await apiClient.markAllRead()
            setRows((current) => current.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })))
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'They could not be marked read.'))
        }
    }

    if (rows.length === 0) {
        return <p className="text-base text-ink-mid">Nothing yet. When something happens to a request you reported, it appears here.</p>
    }

    return (
        <div className="flex flex-col gap-3">
            {error && <ErrorNotice message={error} />}
            <div className="flex items-center justify-between gap-3">
                <p className="text-base text-ink-mid">
                    <span className="mono text-ink">{unread}</span> unread
                </p>
                {unread > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={markAll}>
                        Mark all read
                    </Button>
                )}
            </div>
            <ul className="flex flex-col divide-y divide-line rounded-[var(--radius)] border border-line bg-surface">
                {rows.map((row) => (
                    <li key={row.id}>
                        <Link
                            href={row.href ?? '/notifications'}
                            onClick={(event) => {
                                event.preventDefault()
                                void open(row)
                            }}
                            className={cn('flex gap-3 px-4 py-3 hover:bg-sunk', row.readAt === null && 'bg-brand-soft/40')}
                        >
                            <span
                                className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', row.readAt === null ? 'bg-brand' : 'bg-transparent')}
                                aria-hidden
                            />
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span className={cn('text-base text-ink', row.readAt === null && 'font-semibold')}>
                                    {row.title}
                                    {row.readAt === null && <span className="sr-only"> (unread)</span>}
                                </span>
                                <span className="text-sm text-ink-mid">{row.body}</span>
                                <span className="text-sm text-ink-soft" title={formatDateTime(row.createdAt)}>
                                    {relativeTime(row.createdAt)}
                                </span>
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    )
}
