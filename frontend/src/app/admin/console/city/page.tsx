import { redirect } from 'next/navigation'

/**
 * The old geography screens are gone.
 *
 * Zones, circles and sectors were three tables and three page trees; they are
 * one recursive tree now, with one screen. This keeps the old entry point
 * working rather than leaving a dead link in anyone's bookmarks.
 */
export default function CityPage() {
    redirect('/admin/org')
}
