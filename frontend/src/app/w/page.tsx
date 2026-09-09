import type { Metadata } from 'next'
import { CodeEntry } from './code-entry'

export const metadata: Metadata = {
    title: 'Open a job · DRISHTI-G',
    // A slip left on a bus seat should not turn up in a search engine, and
    // neither should the door it opens.
    robots: { index: false, follow: false },
}

/**
 * The way in for a code that was read down a phone.
 *
 * The QR and the link both land a worker straight on their job. Neither is
 * reliable on a Noida street: the QR will not scan on a cracked screen, and the
 * link is useless with no data left in the month. The fallback the rest of the
 * system is designed around — an officer reading eight characters aloud — had
 * nowhere to be typed, which meant the fallback did not actually work.
 *
 * This is that page, and nothing else.
 */
export default function WorkerEntryPage() {
    return <CodeEntry />
}
