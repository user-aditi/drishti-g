'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normaliseSrNumber } from '@/lib/format'

/**
 * The lookup box.
 *
 * It navigates rather than fetching, for two reasons. The status page has to
 * work as a link anyone can be sent — that is the whole point of an SR number —
 * and a navigation gives that for free. And the "not found" case belongs on the
 * status page, where there is room to say what to check, rather than as a line
 * of red under an input.
 *
 * Input is normalised before it becomes a URL because people read these numbers
 * off a letter or a phone call, and arrive with spaces, hyphens and lowercase.
 * Rejecting those would be a lookup that only works for people who already have
 * the number on their clipboard.
 */
export function LookupForm() {
    const router = useRouter()
    const [value, setValue] = useState('')

    const cleaned = normaliseSrNumber(value)

    function submit(event: FormEvent) {
        event.preventDefault()
        if (!cleaned) return
        router.push(`/sr/${encodeURIComponent(cleaned)}`)
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor="sr-lookup" className="text-base font-medium text-ink">
                Check the status of a request
            </label>
            <div className="flex flex-wrap gap-2">
                <Input
                    id="sr-lookup"
                    name="srNumber"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder="SR-2024-000123"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="sr-lookup-hint"
                    className="mono h-10 max-w-xs flex-1"
                />
                <Button type="submit" size="lg" disabled={!cleaned}>
                    <Search aria-hidden />
                    Look up
                </Button>
            </div>
            <p id="sr-lookup-hint" className="text-sm text-ink-soft">
                No sign-in needed. The SR number was shown when the request was filed.
            </p>
        </form>
    )
}
