import type { Metadata, Viewport } from 'next'
import { Archivo, IBM_Plex_Mono, Public_Sans } from 'next/font/google'
import { THEME_BOOT_SCRIPT } from '@/components/shared/theme-toggle'
import './globals.css'

/**
 * Three faces, each doing one job.
 *
 * Public Sans was drawn for government interfaces and is the running text: it
 * stays legible at the small sizes a dense queue needs, which is most of what
 * an officer reads. Archivo carries headings — a grotesque with enough
 * authority to read as signage rather than as a consumer app. IBM Plex Mono is
 * reserved for the things that must line up or be read aloud: reference
 * numbers, job codes, column labels, counts in a column.
 */
const publicSans = Public_Sans({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-sans-public',
})
const archivo = Archivo({
    subsets: ['latin'],
    weight: ['500', '600', '700'],
    display: 'swap',
    variable: '--font-display-archivo',
})
const plexMono = IBM_Plex_Mono({
    subsets: ['latin'],
    weight: ['400', '500', '600'],
    display: 'swap',
    variable: '--font-mono-plex',
})

export const metadata: Metadata = {
    title: 'DRISHTI-G — NOIDA Authority',
    description:
        'Governance platform for NOIDA Authority: complaints routed through a real chain of command, and a risk score that explains itself.',
    keywords: ['e-governance', 'Noida', 'NOIDA Authority', 'grievance', 'DRISHTI'],
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#4338CA' },
        { media: '(prefers-color-scheme: dark)', color: '#0A0E1A' },
    ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                {/* Resolves the theme before first paint, so navigating at night
                    never flashes a white page. See THEME_BOOT_SCRIPT. */}
                <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
            </head>
            <body
                className={`${publicSans.variable} ${archivo.variable} ${plexMono.variable} font-sans`}
                suppressHydrationWarning
            >
                <a href="#main-content" className="skip-link">
                    Skip to main content
                </a>
                {children}
            </body>
        </html>
    )
}
