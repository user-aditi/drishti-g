import type { Metadata } from 'next'
import { FileWizard } from './wizard'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { ErrorNotice } from '@/components/shared/notices'
import { getBoards, getTaxonomy } from '@/lib/api'
import { messageFrom } from '@/lib/api-error'
import type { Board, RequestType } from '@/types'

export const metadata: Metadata = { title: 'File a request' }

/**
 * Filing needs the taxonomy, so the page fetches it on the server and the
 * wizard opens with its options already in it — no spinner between deciding to
 * report something and being asked what it is.
 *
 * Community boards are optional to the form, so a failure there narrows the
 * form rather than blocking it. The taxonomy is not optional: without it there
 * is no complaint type to file against, and pretending otherwise would mean
 * showing a form that cannot submit.
 */
export default async function FilePage() {
    let types: RequestType[] = []
    let boards: Board[] = []
    let error: string | null = null

    try {
        types = await getTaxonomy()
    } catch (err) {
        error = messageFrom(err, 'The list of complaint types could not be loaded.')
    }

    try {
        boards = await getBoards()
    } catch {
        boards = []
    }

    return (
        <PageShell width="text">
            <PageHeading
                title="File a service request"
                description="Six short steps, two of them optional. You will get an SR number at the end that lets you check on it without an account."
            />

            {error ? (
                <ErrorNotice
                    title="This form cannot be opened right now"
                    message={`${error} Filing needs the list of complaint types, so please try again shortly.`}
                />
            ) : (
                <FileWizard types={types} boards={boards} />
            )}
        </PageShell>
    )
}
