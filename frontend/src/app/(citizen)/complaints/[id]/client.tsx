'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Star } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorBanner, SectionHeading } from '@/components/shared/page-header'
import { cn } from '@/lib/utils'

function StarRating({ value, onChange }: { value: number; onChange: (n: number) => void }) {
    const [hovered, setHovered] = useState(0)

    return (
        <div className="flex gap-1" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    onClick={() => onChange(n)}
                    onMouseEnter={() => setHovered(n)}
                    className="transition-transform hover:scale-110"
                    aria-label={`${n} out of 5`}
                >
                    <Star
                        className={cn(
                            'h-7 w-7',
                            n <= (hovered || value)
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-[color:var(--subtle-foreground)]',
                        )}
                    />
                </button>
            ))}
        </div>
    )
}

/**
 * The two actions a complaint page can offer, depending on who is looking.
 *
 * Split into a client island so the rest of the page stays a server component
 * and arrives fully rendered.
 */
export function ComplaintActionsClient({
    complaintId,
    canRate,
    canClose,
    feedbackRating,
    feedbackComment,
}: {
    complaintId: number
    canRate: boolean
    canClose: boolean
    feedbackRating: number | null
    feedbackComment: string | null
}) {
    const router = useRouter()
    const [rating, setRating] = useState(0)
    const [comment, setComment] = useState('')
    const [busy, setBusy] = useState<'rate' | 'close' | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function submitFeedback(e: FormEvent) {
        e.preventDefault()
        if (rating === 0) return setError('Please choose a rating first.')
        setBusy('rate')
        setError(null)
        try {
            await apiClient.submitFeedback(complaintId, rating, comment || undefined)
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not submit your feedback.'))
        } finally {
            setBusy(null)
        }
    }

    async function close() {
        setBusy('close')
        setError(null)
        try {
            await apiClient.closeComplaint(complaintId)
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not close this complaint.'))
        } finally {
            setBusy(null)
        }
    }

    if (feedbackRating != null) {
        return (
            <Card className="p-5">
                <SectionHeading title="Citizen feedback" />
                <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                            key={n}
                            className={cn(
                                'h-5 w-5',
                                n <= feedbackRating ? 'fill-amber-400 text-amber-400' : 'text-slate-200',
                            )}
                        />
                    ))}
                </div>
                {feedbackComment && (
                    <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">{feedbackComment}</p>
                )}
            </Card>
        )
    }

    if (!canRate && !canClose) return null

    return (
        <Card className="p-5">
            {error && <ErrorBanner message={error} />}

            {canRate && (
                <form onSubmit={submitFeedback} className="space-y-3">
                    <SectionHeading
                        title="Rate the resolution"
                        description="Your rating feeds the ward's performance record."
                    />

                    <div>
                        <Label>How satisfied are you with the work?</Label>
                        <StarRating value={rating} onChange={setRating} />
                    </div>

                    <div>
                        <Label htmlFor="comment">
                            Anything to add? <span className="font-normal opacity-60">(optional)</span>
                        </Label>
                        <Textarea
                            id="comment"
                            rows={2}
                            maxLength={1000}
                            placeholder="Was the work done properly?"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                        />
                    </div>

                    <Button type="submit" disabled={busy !== null}>
                        {busy === 'rate' && <Loader2 className="animate-spin" />}
                        Submit feedback
                    </Button>
                </form>
            )}

            {canClose && (
                <div className={canRate ? 'mt-6 border-t border-[color:var(--border)] pt-5' : undefined}>
                    <SectionHeading
                        title="Sign-off"
                        description="The Section Officer has accepted the work. Closing is yours to authorise."
                    />
                    <Button onClick={() => void close()} disabled={busy !== null}>
                        {busy === 'close' && <Loader2 className="animate-spin" />}
                        Verify and close
                    </Button>
                </div>
            )}
        </Card>
    )
}
