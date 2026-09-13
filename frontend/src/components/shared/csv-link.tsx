import { Download } from 'lucide-react'
import { BROWSER_API } from '@/lib/api-base'

/**
 * Download what this register shows, as CSV.
 *
 * A link, not a button that fetches: the browser handles the download, the
 * session cookie travels with it, and the API decides what the reader may have —
 * the same filters and the same access as the screen.
 */
export function CsvLink({ path, label = 'Download CSV' }: { path: string; label?: string }) {
    return (
        <a
            href={`${BROWSER_API}${path}`}
            className="inline-flex h-8 items-center gap-2 rounded-[var(--radius)] border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-sunk"
        >
            <Download className="h-4 w-4" aria-hidden />
            {label}
        </a>
    )
}
