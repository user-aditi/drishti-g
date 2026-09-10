'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { PAGE_SIZES, QUEUE_SORTS, STATUSES, STATUS_META } from '@/lib/constants'
import type { Board, RequestType } from '@/types'

/**
 * The queue's filters, expressed as the URL.
 *
 * Nothing here holds state. Every control writes a search parameter and lets
 * the server re-render, which is what makes a filtered queue a link somebody
 * can send — "the DEP backlog in BK-08" is a URL, not a sequence of clicks to
 * describe over the phone. It also means the browser's back button undoes a
 * filter, which is what everyone tries first anyway.
 *
 * Changing any filter resets to page one. Staying on page fourteen of a result
 * set that just shrank to two pages is the classic way to show someone an empty
 * table and let them conclude there is nothing there.
 */
export function QueueFilters({ boards, types }: { boards: Board[]; types: RequestType[] }) {
    const router = useRouter()
    const params = useSearchParams()

    function set(key: string, value: string) {
        const next = new URLSearchParams(params.toString())
        if (value) next.set(key, value)
        else next.delete(key)
        next.delete('page')
        router.push(`/agency/queue?${next.toString()}`)
    }

    function toggle(key: string, on: boolean) {
        // A flag is present or absent, never `false`: the API coerces its
        // booleans from strings, under which "false" is true.
        set(key, on ? 'true' : '')
    }

    const value = (key: string) => params.get(key) ?? ''
    const flag = (key: string) => params.get(key) === 'true'
    const anyFilter =
        Boolean(value('orgUnitId') || value('typeId') || value('status')) ||
        flag('openOnly') ||
        flag('overdue')

    return (
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <Label htmlFor="f-board">Community board</Label>
                    <Select
                        id="f-board"
                        value={value('orgUnitId')}
                        onChange={(event) => set('orgUnitId', event.target.value)}
                    >
                        <option value="">All boards</option>
                        {boards.map((board) => (
                            <option key={board.id} value={board.id}>
                                {board.code} — {board.name}
                            </option>
                        ))}
                    </Select>
                </div>

                <div>
                    <Label htmlFor="f-type">Complaint type</Label>
                    <Select
                        id="f-type"
                        value={value('typeId')}
                        onChange={(event) => set('typeId', event.target.value)}
                    >
                        <option value="">All types</option>
                        {types.map((type) => (
                            <option key={type.id} value={type.id}>
                                {type.name}
                            </option>
                        ))}
                    </Select>
                </div>

                <div>
                    <Label htmlFor="f-status">Status</Label>
                    <Select
                        id="f-status"
                        value={value('status')}
                        onChange={(event) => set('status', event.target.value)}
                    >
                        <option value="">Any status</option>
                        {STATUSES.map((status) => (
                            <option key={status} value={status}>
                                {STATUS_META[status].label}
                            </option>
                        ))}
                    </Select>
                </div>

                <div>
                    <Label htmlFor="f-sort">Order</Label>
                    <Select
                        id="f-sort"
                        value={value('sort') || 'age'}
                        onChange={(event) => set('sort', event.target.value)}
                    >
                        {QUEUE_SORTS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label} — {option.hint}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-base text-ink">
                    <input
                        type="checkbox"
                        checked={flag('openOnly')}
                        onChange={(event) => toggle('openOnly', event.target.checked)}
                        className="h-4 w-4 accent-[var(--brand)]"
                    />
                    Open only
                </label>

                <label className="flex items-center gap-2 text-base text-ink">
                    <input
                        type="checkbox"
                        checked={flag('overdue')}
                        onChange={(event) => toggle('overdue', event.target.checked)}
                        className="h-4 w-4 accent-[var(--brand)]"
                    />
                    Past derived deadline<span aria-hidden> †</span>
                </label>

                <label className="flex items-center gap-2 text-base text-ink-mid">
                    Rows
                    <Select
                        aria-label="Rows per page"
                        value={value('pageSize') || '50'}
                        onChange={(event) => set('pageSize', event.target.value)}
                        className="h-8 w-auto"
                    >
                        {PAGE_SIZES.map((size) => (
                            <option key={size} value={size}>
                                {size}
                            </option>
                        ))}
                    </Select>
                </label>

                {anyFilter && (
                    <Button
                        variant="quiet"
                        size="sm"
                        className="ml-auto"
                        onClick={() => router.push('/agency/queue')}
                    >
                        Clear filters
                    </Button>
                )}
            </div>
        </div>
    )
}
