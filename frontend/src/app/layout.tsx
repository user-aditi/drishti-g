import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Public_Sans } from 'next/font/google'
import { THEME_BOOT_SCRIPT } from '@/components/shared/theme-toggle'
import { SiteHeader } from '@/components/shared/site-header'
import { SiteFooter } from '@/components/shared/site-footer'
import { getUnreadCount } from '@/lib/api'
import { auth } from '@/lib/auth'
import { getWaiting } from '@/lib/layer4-server'
import './globals.css'

/**
 * Two faces, each doing one job.
 *
 * Public Sans was commissioned by the US government for civic interfaces and
 * is the running text: it stays legible at the small sizes a dense register
 * needs, which is most of what anyone reads here. IBM Plex Mono is reserved for
 * things that must line up in a column or be read down a phone — SR numbers,
 * timestamps, counts — with tabular figures so a column of them is a column
 * rather than a ragged edge.
 */
const publicSans = Public_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-public-sans',
})

const plexMono = IBM_Plex_Mono({
    subsets: ['latin'],
    weight: ['400', '500', '600'],
    display: 'swap',
    variable: '--font-plex-mono',
})

export const metadata: Metadata = {
    title: {
        default: '311 Service Requests — academic replica',
        template: '%s · 311 replica',
    },
    description:
        'An academic replica of NYC 311, built on published NYC Open Data service requests for Brooklyn. Not affiliated with the City of New York.',
    // Search engines should not present a replica of a municipal service as the
    // municipal service. Someone must arrive here on purpose.
    robots: { index: false, follow: false },
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#12467F' },
        { media: '(prefers-color-scheme: dark)', color: '#0C0F14' },
    ],
}

// The header renders the current session, so no page in the app may be
// statically prerendered — the cookie is only readable per request.
export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const user = await auth()

    // Layer 4: how many crews are waiting on this resident's answer, shown beside
    // their own register. A failure costs the count, never the page.
    const counts: Record<string, number> = {}
    if (user?.role === 'CITIZEN') {
        try {
            const waiting = await getWaiting()
            if (waiting.rows.length > 0) counts['/my/requests'] = waiting.rows.length
        } catch {
            // No count, same page.
        }
    }
    // Unread notifications, for anyone signed in.
    if (user) {
        try {
            const { unread } = await getUnreadCount()
            if (unread > 0) counts['/notifications'] = unread
        } catch {
            // No count, same page.
        }
    }

    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                {/* Resolves the theme before first paint, so navigating at night
                    never flashes a white page. See THEME_BOOT_SCRIPT. */}
                <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
            </head>
            <body
                className={`${publicSans.variable} ${plexMono.variable} flex min-h-screen flex-col`}
                suppressHydrationWarning
            >
                <a href="#main-content" className="skip-link">
                    Skip to main content
                </a>
                <SiteHeader user={user} counts={counts} />
                <main id="main-content" className="flex-1">
                    {children}
                </main>
                {/* Every page, no exceptions — see SiteFooter for why. */}
                <SiteFooter />
            </body>
        </html>
    )
}
