import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { LookupForm } from './lookup-form'
import { PageShell } from '@/components/shared/page-heading'
import { Panel, PanelBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DATASET } from '@/lib/constants'

/**
 * The front door does two things: file, or look up. That is all.
 *
 * Deliberately not a dashboard. Counts of open requests across Brooklyn are of
 * enormous interest to someone working the queue and of none at all to a person
 * standing next to a broken street light — and this page belongs to the second
 * one. Everything analytical lives behind a sign-in, where the people it is
 * for already are.
 */
export default function HomePage() {
    return (
        <PageShell width="text">
            <div className="flex flex-col gap-3">
                <h1 className="text-3xl font-semibold text-ink">
                    Report a problem to a city agency
                </h1>
                <p className="prose-measure text-lg text-ink-mid">
                    Street conditions, street lights, sewers, water, missed collections and dirty
                    conditions in Brooklyn. Filing gives you an SR number you can use to check on
                    it later, without an account.
                </p>
            </div>

            <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                    <Link href="/file">
                        File a request
                        <ArrowRight aria-hidden />
                    </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                    <Link href="/boards">See how each community board is doing</Link>
                </Button>
            </div>

            <Panel>
                <PanelBody>
                    <LookupForm />
                </PanelBody>
            </Panel>

            {/*
             * The one place on the site where the point of the exercise is
             * stated rather than disclaimed. The footer's job is the legal
             * boundary; this is the honest explanation of what a reader is
             * actually looking at and where its contents came from.
             */}
            <section className="flex flex-col gap-2 border-t border-line pt-6">
                <h2 className="text-lg font-semibold text-ink">What this is</h2>
                <p className="prose-measure text-base text-ink-mid">
                    A university research project that rebuilds the public behaviour of NYC 311 on
                    the City&apos;s own published records — {DATASET.rows.toLocaleString('en-US')}{' '}
                    {DATASET.borough} service requests filed between {DATASET.span}, downloaded
                    from {DATASET.portal}. Historical requests you find here are real records of
                    what New York did. Requests filed here are not: they stay inside this project
                    and no agency will see them.
                </p>
                <p className="prose-measure text-base text-ink-mid">
                    If you need to report something in New York City, use{' '}
                    <a
                        href="https://portal.311.nyc.gov/"
                        className="text-brand underline underline-offset-2"
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        the real NYC 311
                    </a>
                    .
                </p>
            </section>
        </PageShell>
    )
}
