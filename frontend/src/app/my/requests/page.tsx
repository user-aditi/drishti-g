import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { RequestRegister } from '@/components/request/request-register'
import { ErrorNotice } from '@/components/shared/notices'
import { ReferenceDate } from '@/components/shared/reference-date'
import { Button } from '@/components/ui/button'
import { getHealth, getMyRequests } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { messageFrom } from '@/lib/api-error'
import type { ServiceRequest } from '@/types'

export const metadata: Metadata = { title: 'My requests' }
export const dynamic = 'force-dynamic'

/**
 * The requests this person filed, and nothing else.
 *
 * A register rather than a list of cards even here, where there may only be
 * three rows: it is the same information as the agency queue and it should read
 * the same way, so that someone who files a request and later reads the queue
 * over a colleague's shoulder is looking at one system rather than two.
 *
 * The API returns the whole list — a person's own filings are tens of rows, not
 * hundreds of thousands — so this is the one register in the app that is not
 * server-paged, and its pager is therefore a single page by construction.
 */
export default async function MyRequestsPage() {
    // Citizens and agents both file; an agent's own reports belong to them, not
    // to their queue, so this page is not role-restricted beyond being signed in.
    await requireUser()

    let rows: ServiceRequest[] = []
    let error: string | null = null

    try {
        rows = (await getMyRequests()).rows
    } catch (err) {
        error = messageFrom(err, 'Your requests could not be loaded.')
    }

    let referenceDate = new Date().toISOString()
    try {
        referenceDate = (await getHealth()).referenceDate
    } catch {
        // The register still renders; ages fall back to the reader's clock.
    }

    const overdue = rows.filter((row) => row.isOverdue && row.status !== 'CLOSED').length

    return (
        <PageShell>
            <PageHeading
                title="My requests"
                description="Every request filed under this account. Anyone holding the SR number can see the same status page without signing in."
                actions={
                    <Button asChild>
                        <Link href="/file">File a request</Link>
                    </Button>
                }
            />

            {error ? (
                <ErrorNotice title="Could not load your requests" message={error} />
            ) : (
                <>
                    {/* The reference date is shown wherever an overdue count is,
                        and only where one is — see ReferenceDate. */}
                    {overdue > 0 && <ReferenceDate referenceDate={referenceDate} />}

                    <RequestRegister
                        rows={rows}
                        page={1}
                        pageSize={Math.max(rows.length, 1)}
                        total={rows.length}
                        referenceDate={referenceDate}
                        hrefForPage={() => '/my/requests'}
                        hrefForRow={(request) =>
                            `/sr/${encodeURIComponent(request.srNumber)}`
                        }
                        emptyMessage={
                            <>
                                You have not filed anything yet.{' '}
                                <Link
                                    href="/file"
                                    className="text-brand underline underline-offset-2"
                                >
                                    File a request
                                </Link>
                                .
                            </>
                        }
                    />
                </>
            )}
        </PageShell>
    )
}
