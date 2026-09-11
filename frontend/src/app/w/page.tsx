'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Where a crew types a code by hand.
 *
 * The QR will not always scan — a creased slip, a cracked screen, a code read
 * aloud down a phone — so the fallback has to exist and has to be forgiving:
 * lower case, spaces and a missing dash are all accepted, because the API
 * normalises the code before looking it up.
 */
export default function WorkCodeEntry() {
    const router = useRouter()
    const [code, setCode] = useState('')

    function open(event: React.FormEvent) {
        event.preventDefault()
        const bare = code.trim()
        if (bare) router.push(`/w/${encodeURIComponent(bare)}`)
    }

    return (
        <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
            <div className="flex flex-col gap-2">
                <h1 className="text-[24px] font-semibold text-ink">Open a job</h1>
                <p className="text-lg text-ink-mid">
                    Type the eight-character code from the slip or the message you were sent.
                </p>
            </div>
            <form onSubmit={open} className="flex flex-col gap-3">
                <div>
                    <Label htmlFor="job-code">Job code</Label>
                    <Input
                        id="job-code"
                        className="mono text-2xl tracking-wider"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="K7M2-4QX9"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                    />
                </div>
                <Button type="submit" size="lg" disabled={code.trim() === ''}>
                    Open the job
                </Button>
            </form>
            <p className="text-sm text-ink-soft">
                Part of an academic replica of NYC 311. Nothing reported here reaches the City of New York.
            </p>
        </main>
    )
}
