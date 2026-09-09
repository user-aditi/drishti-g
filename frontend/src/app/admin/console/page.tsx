import { redirect } from 'next/navigation'

/**
 * The console has no front page.
 *
 * A dashboard of counts was one more screen to read before doing anything, so
 * the console opens on the city itself — the thing every other register hangs
 * off — rather than on a summary of it.
 */
export default function ConsoleIndexPage() {
    redirect('/admin/org')
}
