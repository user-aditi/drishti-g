import type { Metadata } from 'next'
import { CrewJob } from './crew-job'

export const metadata: Metadata = {
    title: 'Job',
    // A slip left on a bus seat should not turn up in a search engine.
    robots: { index: false, follow: false },
}

/**
 * The crew's page. Layer 1.
 *
 * No sign-in and no role guard: the code in the address is the whole
 * credential, and the people using it have no account and never will. Rendered
 * on the client because there is no session cookie to forward — the code is
 * the only thing the request carries.
 */
export default function CrewJobPage({ params }: { params: { code: string } }) {
    return <CrewJob code={decodeURIComponent(params.code)} />
}
