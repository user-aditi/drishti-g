import type { Metadata } from 'next'
import { WorkerPortal } from './client'

export const metadata: Metadata = {
    title: 'Job · DRISHTI-G',
    // A slip left on a bus seat should not turn up in a search engine.
    robots: { index: false, follow: false },
}

/**
 * The street worker's page.
 *
 * Sits outside every layout in the app — no sidebar, no auth guard, no session.
 * A worker arrives here from a QR on a printed slip or a WhatsApp link, does
 * one thing, and leaves. Anything else on the screen is in their way.
 *
 * Rendered on the client because this is the one page where the data is fetched
 * with no cookie to forward: the code in the URL is the entire credential.
 */
export default function WorkerJobPage({ params }: { params: { code: string } }) {
    return <WorkerPortal code={params.code} />
}
