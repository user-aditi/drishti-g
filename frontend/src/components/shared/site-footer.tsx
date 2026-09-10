import { DATASET } from '@/lib/constants'

/**
 * The label this project is obliged to wear, on every page.
 *
 * This interface is a close replica of a real municipal service, built on that
 * city's own published records. That combination is exactly the one that
 * misleads: someone arriving mid-flow from a search result has no other way to
 * know they are not talking to New York. So the disclaimer is not a link on an
 * about page, it is in the footer of every route, it names the dataset it is
 * built from, and it says plainly what this is not.
 *
 * The City's seal and wordmark are deliberately absent and must stay absent —
 * borrowing them is what turns "academic replica" into impersonation.
 */
export function SiteFooter() {
    return (
        <footer className="mt-auto border-t border-line bg-surface">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-6 sm:px-6">
                <p className="prose-measure text-sm text-ink-mid">
                    <strong className="font-semibold text-ink">
                        Academic replica — not a City of New York service.
                    </strong>{' '}
                    This is a final-year university project that reproduces the public behaviour of
                    NYC 311 for research purposes. It is not affiliated with, endorsed by, or a
                    substitute for the real{' '}
                    <a
                        href="https://portal.311.nyc.gov/"
                        className="text-brand underline underline-offset-2"
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        NYC 311 service
                    </a>
                    . Nothing filed here reaches the City, and no city agency will act on it. To
                    report a real problem in New York City, contact 311 directly.
                </p>

                <p className="prose-measure text-sm text-ink-soft">
                    Built on{' '}
                    <a
                        href={DATASET.url}
                        className="text-brand underline underline-offset-2"
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        {DATASET.name}
                    </a>{' '}
                    (<span className="mono">{DATASET.resourceId}</span>), published by{' '}
                    {DATASET.portal} under its Terms of Use —{' '}
                    <span className="mono tnum">{DATASET.rows.toLocaleString('en-US')}</span>{' '}
                    {DATASET.borough} service requests, {DATASET.span}. Map tiles ©{' '}
                    <a
                        href="https://www.openstreetmap.org/copyright"
                        className="text-brand underline underline-offset-2"
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        OpenStreetMap
                    </a>{' '}
                    contributors.
                </p>
            </div>
        </footer>
    )
}
