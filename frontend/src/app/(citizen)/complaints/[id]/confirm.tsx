'use client'

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CheckCircle2, Loader2, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ErrorBanner } from '@/components/shared/page-header'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { WorkProofView } from '@/types'

/**
 * "Is it actually fixed?"
 *
 * The hinge of the whole verification design. Everything upstream — the code,
 * the upload, the automated checks — exists to get a credible claim in front of
 * the one person who can settle it, and this is where they settle it.
 *
 * Both answers are given equal weight on screen on purpose. A confirm button
 * three times the size of the deny button is a system fishing for closures, and
 * a resident can tell.
 */
export function ConfirmWorkPanel({
    complaintId,
    proof,
}: {
    complaintId: number
    proof: WorkProofView
}) {
    const router = useRouter()
    const [choice, setChoice] = useState<'yes' | 'no' | null>(null)
    const [rating, setRating] = useState<number>(0)
    const [comment, setComment] = useState('')
    const [photo, setPhoto] = useState<File | null>(null)
    const [preview, setPreview] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    function choosePhoto(file: File | null) {
        if (preview) URL.revokeObjectURL(preview)
        setPhoto(file)
        setPreview(file ? URL.createObjectURL(file) : null)
    }

    async function submit(e: FormEvent) {
        e.preventDefault()
        if (choice == null) return
        setSubmitting(true)
        setError(null)
        try {
            const form = new FormData()
            form.append('confirmed', choice === 'yes' ? 'true' : 'false')
            if (choice === 'yes' && rating > 0) form.append('rating', String(rating))
            if (comment) form.append('comment', comment)
            if (photo) form.append('photo', photo)

            await apiClient.confirmWork(complaintId, form)
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not record your answer.'))
            setSubmitting(false)
        }
    }

    return (
        <Card className="border-2 border-[color:var(--primary)] p-5">
            <div className="flex items-start gap-3">
                <CheckCircle2
                    className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--primary)]"
                    aria-hidden
                />
                <div className="min-w-0">
                    <h2 className="text-lg font-bold leading-tight">
                        The crew says this is done. Is it?
                    </h2>
                    <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                        Your answer is what closes this. Nobody at the authority has to sign it off
                        if you confirm it — and if it is not done, saying so puts it straight back on
                        the officer&rsquo;s desk.
                    </p>
                </div>
            </div>

            {/* What the crew sent, so the citizen is judging evidence rather
                than taking the system's word for it. */}
            {proof.files.length > 0 && (
                <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                        What the crew sent {proof.submittedAt && `· ${formatDateTime(proof.submittedAt)}`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {proof.files.map((f) =>
                            f.kind === 'IMAGE' ? (
                                <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={f.url}
                                        alt="Photo of the completed work"
                                        className="h-32 w-auto rounded-lg border border-[color:var(--border)] object-cover"
                                    />
                                </a>
                            ) : (
                                <a
                                    key={f.id}
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex h-32 w-32 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--muted)] text-xs font-medium"
                                >
                                    Open {f.kind.toLowerCase()}
                                </a>
                            ),
                        )}
                    </div>
                    {proof.note && (
                        <p className="mt-2 rounded-lg bg-[color:var(--muted)] px-3 py-2 text-sm">
                            &ldquo;{proof.note}&rdquo;
                        </p>
                    )}
                </div>
            )}

            {error && (
                <div className="mt-4">
                    <ErrorBanner message={error} />
                </div>
            )}

            <form onSubmit={submit} className="mt-5">
                <div className="grid gap-2 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={() => setChoice('yes')}
                        aria-pressed={choice === 'yes'}
                        className={cn(
                            'flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3.5 text-base font-semibold transition-colors',
                            choice === 'yes'
                                ? 'border-emerald-600 bg-[color:var(--success-bg)] text-[color:var(--success-fg)]'
                                : 'border-[color:var(--input)] hover:border-emerald-400',
                        )}
                    >
                        <ThumbsUp className="h-5 w-5" aria-hidden />
                        Yes, it is fixed
                    </button>
                    <button
                        type="button"
                        onClick={() => setChoice('no')}
                        aria-pressed={choice === 'no'}
                        className={cn(
                            'flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3.5 text-base font-semibold transition-colors',
                            choice === 'no'
                                ? 'border-red-600 bg-[color:var(--error-bg)] text-[color:var(--error-fg)]'
                                : 'border-[color:var(--input)] hover:border-red-400',
                        )}
                    >
                        <ThumbsDown className="h-5 w-5" aria-hidden />
                        No, still a problem
                    </button>
                </div>

                {choice === 'yes' && (
                    <div className="mt-4">
                        <p className="text-sm font-medium">How was the work?</p>
                        <div className="mt-1.5 flex gap-1.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(star)}
                                    aria-label={`${star} out of 5`}
                                    className={cn(
                                        'h-10 w-10 rounded-lg text-xl transition-colors',
                                        star <= rating
                                            ? 'bg-[color:var(--warning-bg)] text-[color:var(--warning)]'
                                            : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
                                    )}
                                >
                                    {star <= rating ? '★' : '☆'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {choice != null && (
                    <>
                        <label htmlFor="confirm-comment" className="mt-4 block text-sm font-medium">
                            {choice === 'yes'
                                ? 'Anything to add? (optional)'
                                : 'What is still wrong?'}
                        </label>
                        <Textarea
                            id="confirm-comment"
                            rows={2}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder={
                                choice === 'yes'
                                    ? 'e.g. Done properly, thank you'
                                    : 'e.g. Sirf upar se saaf kiya, nali abhi bhi band hai'
                            }
                            className="mt-1"
                        />

                        <div className="mt-3">
                            <p className="mb-1.5 text-sm font-medium">
                                Add your own photo{' '}
                                <span className="font-normal text-[color:var(--muted-foreground)]">
                                    (optional
                                    {choice === 'no' ? ', but it helps the officer a great deal' : ''})
                                </span>
                            </p>
                            {preview ? (
                                <div className="relative w-fit">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={preview}
                                        alt="Your photo"
                                        className="h-28 w-auto rounded-lg border border-[color:var(--border)] object-cover"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            choosePhoto(null)
                                            if (fileRef.current) fileRef.current.value = ''
                                        }}
                                        aria-label="Remove photo"
                                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-white"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ) : (
                                <label
                                    htmlFor="citizen-proof"
                                    className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-[color:var(--input)] px-4 py-2.5 text-sm font-medium"
                                >
                                    <Camera className="h-4 w-4" aria-hidden />
                                    Add a photo
                                </label>
                            )}
                            <input
                                ref={fileRef}
                                id="citizen-proof"
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/heic"
                                capture="environment"
                                className="sr-only"
                                onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
                            />
                        </div>

                        <Button type="submit" size="lg" className="mt-5 w-full" disabled={submitting}>
                            {submitting && <Loader2 className="animate-spin" />}
                            {choice === 'yes' ? 'Confirm and close this' : 'Send it back to the officer'}
                        </Button>
                    </>
                )}
            </form>
        </Card>
    )
}
