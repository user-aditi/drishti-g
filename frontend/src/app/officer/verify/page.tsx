import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LayerMark, StaffName } from '@/components/layer1/marks'
import { ProofChecks } from '@/components/layer4/proof-checks'
import { DecideProof } from '@/components/layer4/proof-actions'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { SrNumber, StatusPill } from '@/components/shared/request-bits'
import { Badge } from '@/components/ui/badge'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { messageFrom } from '@/lib/api-error'
import { homeFor, requireUser } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import { RequestPhotos } from '@/components/request/request-photos'
import { proofPhotoUrl } from '@/lib/layer4-urls'
import { getProofQueue } from '@/lib/layer4-server'
import type { ProofQueue } from '@/types/layer4'

export const metadata: Metadata = { title: 'Work to check' }
export const dynamic = 'force-dynamic'

/**
 * What actually needs an officer. Layer 4.
 *
 * Deliberately short, and it should stay short. A submission reaches this page
 * only when the resident who reported the problem disputed it, or when the
 * proof was weak and nobody vouched for it before the grace period ran out.
 * Everything else settles without an officer — which is the point: routing
 * every closure across this desk is the bottleneck that makes these systems rot.
 */
export default async function VerifyPage() {
    const user = await requireUser()
    if (user.role !== 'OFFICER' && user.role !== 'SUPERVISOR') redirect(homeFor(user.role))

    let queue: ProofQueue | null = null
    let error: string | null = null
    try {
        queue = await getProofQueue()
    } catch (err) {
        error = messageFrom(err, 'The queue could not be loaded.')
    }

    return (
        <PageShell>
            <PageHeading
                title="Work to check"
                actions={<LayerMark layer={4} />}
                description="Jobs whose photographs need a person: the resident said the work was not done, or nobody was there to ask and the proof was thin. Everything the checks and the resident settled between them stays off this page."
            />

            {error ? (
                <ErrorNotice title="Could not load the queue" message={error} />
            ) : (
                queue && (
                    <>
                        <p className="text-[14.5px] text-ink-mid">
                            <span className="mono text-ink">{queue.rows.length}</span>{' '}
                            {queue.rows.length === 1 ? 'job is' : 'jobs are'} waiting on you.
                        </p>

                        {queue.rows.length === 0 ? (
                            <Panel>
                                <PanelBody>
                                    <p className="text-ink-mid">
                                        Nothing is waiting. Submissions arrive here only when a resident
                                        disputes the work, or when weak proof goes unanswered.
                                    </p>
                                </PanelBody>
                            </Panel>
                        ) : (
                            <div className="flex flex-col gap-6">
                                {queue.rows.map((row) => (
                                    <Panel key={row.workOrderId}>
                                        <PanelHeader>
                                            <PanelTitle>
                                                <span className="inline-flex flex-wrap items-center gap-3">
                                                    <Link
                                                        href={`/officer/sr/${encodeURIComponent(row.request.srNumber)}`}
                                                        className="text-brand underline underline-offset-2"
                                                    >
                                                        <SrNumber value={row.request.srNumber} />
                                                    </Link>
                                                    <span className="text-ink">{row.request.type?.name}</span>
                                                    <StatusPill status={row.request.status} />
                                                    {row.citizenVerdict === false && (
                                                        <Badge tone="stop">The resident says it is not done</Badge>
                                                    )}
                                                    {row.citizenVerdict === null && (
                                                        <Badge tone="wait">Nobody answered</Badge>
                                                    )}
                                                </span>
                                            </PanelTitle>
                                        </PanelHeader>
                                        <PanelBody>
                                            <div className="flex flex-col gap-4">
                                                <div className="flex flex-col gap-1 text-sm text-ink-mid">
                                                    <span>
                                                        {row.request.address ?? 'No street address on the record'}
                                                        {row.request.orgUnit &&
                                                            ` · ${row.request.orgUnit.name} (${row.request.orgUnit.code})`}
                                                    </span>
                                                    <span>
                                                        Job <span className="mono">{row.code}</span>
                                                        {row.completedAt && ` · reported done ${formatDateTime(row.completedAt)}`}
                                                        {row.request.assignedOfficer && (
                                                            <>
                                                                {' · '}
                                                                <StaffName
                                                                    name={row.request.assignedOfficer.name}
                                                                    isSynthetic={row.request.assignedOfficer.isSynthetic}
                                                                />
                                                            </>
                                                        )}
                                                    </span>
                                                    {row.completionNote && (
                                                        <span className="text-ink">
                                                            The crew wrote: &ldquo;{row.completionNote}&rdquo;
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Before: what the resident reported, when they attached anything. */}
                                                <RequestPhotos
                                                    srNumber={row.request.srNumber}
                                                    title="Reported with"
                                                    compact
                                                />

                                                {row.photos.length > 0 && (
                                                    <div className="flex flex-wrap gap-3">
                                                        {row.photos.map((photo) => (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                key={photo.storedName}
                                                                src={proofPhotoUrl(photo.storedName)}
                                                                crossOrigin="use-credentials"
                                                                alt={`Sent back from job ${row.code}`}
                                                                className="h-44 w-auto rounded-[var(--radius)] border border-line object-cover"
                                                            />
                                                        ))}
                                                    </div>
                                                )}

                                                {row.proof && <ProofChecks proof={row.proof} />}
                                                <DecideProof workOrderId={row.workOrderId} />
                                                <Link
                                                    href={`/officer/sr/${encodeURIComponent(row.request.srNumber)}#status`}
                                                    className="text-sm text-brand underline underline-offset-2"
                                                >
                                                    Once the work is accepted, close the request here
                                                </Link>
                                            </div>
                                        </PanelBody>
                                    </Panel>
                                ))}
                            </div>
                        )}

                        <p className="text-sm text-ink-soft">
                            Accepting records the work as proven. It does not close the request: closing is a
                            statement about the problem, and you make it on the request itself.
                        </p>
                    </>
                )
            )}
        </PageShell>
    )
}
