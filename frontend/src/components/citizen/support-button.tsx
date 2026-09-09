'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Users } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Priority, SupportThreshold } from '@/types'

const PRIORITY_WORD: Record<Priority, string> = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
}

const PRIORITY_RANK: Record<Priority, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
}

/**
 * "This affects me too."
 *
 * The whole mechanism rests on this button being worth pressing, so it never
 * just changes colour: it says how many neighbours now stand behind the
 * grievance, and how many more it takes to move the authority's priority. A
 * citizen who cannot see what their support did will not give it twice.
 */
export function SupportButton({
    complaintId,
    supporters,
    hasSupported,
    canSupport,
    isAuthor,
    nextThreshold,
    currentPriority,
    showEligibilityHint = true,
    size = 'sm',
    className,
}: {
    complaintId: number
    supporters: number
    hasSupported: boolean
    canSupport: boolean
    isAuthor?: boolean
    nextThreshold: SupportThreshold | null
    /**
     * What the grievance is already set to. An officer may have marked it High
     * for reasons of their own, and promising that one more neighbour "makes
     * this high priority" when it already is reads as the system not knowing
     * its own state.
     */
    currentPriority?: Priority
    /**
     * Whether to explain the sector rule when the viewer cannot back this.
     * Off for officers, who are reading the backing as evidence of how many
     * households are affected rather than deciding whether to join in.
     */
    showEligibilityHint?: boolean
    size?: 'sm' | 'default'
    className?: string
}) {
    const router = useRouter()
    const [count, setCount] = useState(supporters)
    const [supported, setSupported] = useState(hasSupported)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [raisedTo, setRaisedTo] = useState<Priority | null>(null)

    async function toggle() {
        setBusy(true)
        setError(null)
        try {
            if (supported) {
                const res = await apiClient.withdrawSupport(complaintId)
                setCount(res.supporters)
                setSupported(false)
                setRaisedTo(null)
            } else {
                const res = await apiClient.supportIssue(complaintId)
                setCount(res.supporters)
                setSupported(true)
                setRaisedTo(res.raisedTo)
            }
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not record that just now.'))
        } finally {
            setBusy(false)
        }
    }

    const remaining = nextThreshold ? Math.max(nextThreshold.supporters - count, 0) : 0

    // Only promise a rung that would actually be a promotion.
    const thresholdIsAnUpgrade =
        nextThreshold != null &&
        (currentPriority == null ||
            PRIORITY_RANK[nextThreshold.priority] > PRIORITY_RANK[currentPriority])

    return (
        <div className={cn('space-y-1.5', className)}>
            <div className="flex flex-wrap items-center gap-2.5">
                {isAuthor ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--accent-foreground)]">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        You reported this
                    </span>
                ) : canSupport || supported ? (
                    <Button
                        size={size}
                        variant={supported ? 'outline' : 'default'}
                        onClick={() => void toggle()}
                        disabled={busy}
                    >
                        {busy ? (
                            <Loader2 className="animate-spin" />
                        ) : supported ? (
                            <Check />
                        ) : (
                            <Users />
                        )}
                        {supported ? 'You backed this' : 'This affects me too'}
                    </Button>
                ) : null}

                <span className="tnum inline-flex items-center gap-1.5 text-sm text-[color:var(--muted-foreground)]">
                    <Users className="h-4 w-4" aria-hidden />
                    {count === 0
                        ? 'No neighbours yet'
                        : `${count} ${count === 1 ? 'neighbour' : 'neighbours'} backing this`}
                </span>
            </div>

            {raisedTo && (
                <p className="text-xs font-medium text-[color:var(--success)]">
                    Your support pushed this to {PRIORITY_WORD[raisedTo]} priority. The officer
                    holding it has been told.
                </p>
            )}

            {!raisedTo && nextThreshold && thresholdIsAnUpgrade && remaining > 0 && (
                <p className="text-xs text-[color:var(--muted-foreground)]">
                    {remaining} more {remaining === 1 ? 'neighbour' : 'neighbours'} makes this{' '}
                    {PRIORITY_WORD[nextThreshold.priority]} priority.
                </p>
            )}

            {showEligibilityHint && !canSupport && !supported && !isAuthor && (
                <p className="text-xs text-[color:var(--muted-foreground)]">
                    You can back grievances in the sector you live in.
                </p>
            )}

            {error && <p className="text-xs text-[color:var(--error)]">{error}</p>}
        </div>
    )
}
