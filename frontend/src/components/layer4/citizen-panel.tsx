import { LayerMark } from '@/components/layer1/marks'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { getCitizenQuestion } from '@/lib/layer4-server'
import { proofPhotoUrl } from '@/lib/layer4-urls'
import { RequestPhotos } from '@/components/request/request-photos'
import { CitizenVerdict } from './proof-actions'

/**
 * The question put to the person who reported the problem. Layer 4.
 *
 * Renders nothing at all unless the reader is that person and a crew has said
 * the job is done. They are the only one who can see the street, so they are
 * asked before an officer is — and their answer outranks every check the system
 * ran on the photograph.
 *
 * A failure here shows nothing rather than an error: this panel is an extra
 * question on somebody else's page, and it must never come between a resident
 * and the record they came to read.
 */
export async function CitizenProofPanel({ srNumber }: { srNumber: string }) {
    let question = null
    try {
        question = await getCitizenQuestion(srNumber)
    } catch {
        return null
    }
    if (!question) return null

    return (
        <Panel>
            <PanelHeader>
                <PanelTitle>
                    <span className="inline-flex items-center gap-3">
                        Has this been done? <LayerMark layer={4} />
                    </span>
                </PanelTitle>
            </PanelHeader>
            <PanelBody>
                <div className="flex flex-col gap-4">
                    <p className="text-[14.5px] text-ink-mid">
                        A crew reported this finished
                        {question.completedAt ? ` on ${formatDateTime(question.completedAt)}` : ''} and sent
                        {question.photos.length === 1 ? ' a photograph' : ` ${question.photos.length} photographs`}.
                        You reported the problem, so you are asked before anyone else: does it match what you
                        can see? Your answer settles it either way.
                    </p>
                    {question.completionNote && (
                        <p className="text-[14.5px] text-ink">
                            The crew wrote: &ldquo;{question.completionNote}&rdquo;
                        </p>
                    )}
                    {/* Before and after: what they reported, then what the crew sent. */}
                    <RequestPhotos srNumber={srNumber} title="What you reported" compact />
                    {question.photos.length > 0 && (
                        <div className="flex flex-col gap-2">
                        <span className="text-sm text-ink-mid">What the crew sent</span>
                        <div className="flex flex-wrap gap-3">
                            {question.photos.map((photo) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={photo.storedName}
                                    src={proofPhotoUrl(photo.storedName)}
                                    crossOrigin="use-credentials"
                                    alt="Sent back by the crew"
                                    className="h-48 w-auto rounded-[var(--radius)] border border-line object-cover"
                                />
                            ))}
                        </div>
                        </div>
                    )}
                    <CitizenVerdict workOrderId={question.workOrderId} />
                    <p className="text-sm text-ink-soft">
                        If you say nothing, the system decides on its own after 48 hours: strong proof is
                        accepted, weak proof goes to the officer.
                    </p>
                </div>
            </PanelBody>
        </Panel>
    )
}
