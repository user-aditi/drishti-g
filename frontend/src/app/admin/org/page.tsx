import { redirect } from 'next/navigation'
import { serverFetch } from '@/lib/api'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/**
 * The entry point to the tree.
 *
 * There is no separate "top of the city" screen — the root is just a unit, so
 * this hands straight over to the one drill-down page rather than duplicating
 * it. Keeping a stable `/admin/org` URL means the nav never has to know which
 * unit a given person enters at: the API answers that from their posting.
 */
export default async function OrgIndexPage() {
    let rootId: number
    try {
        ;({ rootId } = await serverFetch<{ rootId: number }>('/console/units'))
    } catch (err) {
        // A session that expires between the layout's check and this fetch would
        // otherwise surface as a crash. Send them to sign in again instead.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            redirect('/login')
        }
        // Nobody posted anywhere — real for a brand-new account, and not an error.
        if (err instanceof ApiError && err.status === 404) {
            redirect('/admin/dashboard')
        }
        throw err
    }

    redirect(`/admin/org/${rootId}`)
}
