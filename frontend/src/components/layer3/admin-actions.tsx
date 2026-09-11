'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { messageFrom } from '@/lib/api-error'
import { layer3Client } from '@/lib/layer3-api'
import type { ChainVerification, RecomputeResult } from '@/types/layer3'

/** Rescore every unit-month from the requests as they stand now. */
export function RecomputeButton() {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<RecomputeResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function run() {
        setBusy(true)
        setError(null)
        try {
            setResult(await layer3Client.recompute())
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The scores could not be recomputed.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            {error && <ErrorNotice title="Recompute failed" message={error} />}
            <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={run} disabled={busy || pending}>
                    {busy ? 'Scoring…' : 'Recompute scores'}
                </Button>
                {result && (
                    <span className="text-sm text-ink-mid">
                        {result.unitMonths.toLocaleString('en-US')} unit-months scored ({result.firstMonth} to{' '}
                        {result.lastMonth}), {result.flagged} flagged, in {(result.tookMs / 1000).toFixed(1)}s.
                    </span>
                )}
            </div>
        </div>
    )
}

/**
 * Walk the hash chain from genesis and say whether it holds — and if not, where
 * it breaks and how, which is the difference between a claim and a check.
 */
export function VerifyChainButton() {
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<ChainVerification | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function run() {
        setBusy(true)
        setError(null)
        try {
            setResult(await layer3Client.verifyChain())
        } catch (err) {
            setError(messageFrom(err, 'The chain could not be verified.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            {error && <ErrorNotice title="Verification failed to run" message={error} />}
            <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={run} disabled={busy}>
                    {busy ? 'Verifying…' : 'Verify the chain'}
                </Button>
                {result &&
                    (result.ok ? (
                        <span className="text-sm text-done">
                            Intact: {result.checked.toLocaleString('en-US')} entries verify, head{' '}
                            <span className="mono">{result.head?.slice(0, 12)}</span>.
                        </span>
                    ) : (
                        <span className="text-sm text-stop">
                            Broken at entry #{result.brokenAt}: {result.reason}
                        </span>
                    ))}
            </div>
        </div>
    )
}
