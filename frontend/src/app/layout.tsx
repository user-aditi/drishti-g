import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })
const jetbrains = JetBrains_Mono({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-mono-jet',
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
    themeColor: '#22666B',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${inter.variable} ${jetbrains.variable} font-sans`} suppressHydrationWarning>
                <a href="#main-content" className="skip-link">
                    Skip to main content
                </a>
                {children}
            </body>
        </html>
    )
}
