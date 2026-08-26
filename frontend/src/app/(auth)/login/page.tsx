import type { Metadata } from 'next'
import { LoginClient } from './client'

export const metadata: Metadata = { title: 'Sign in · DRISHTI-G' }

export default function LoginPage() {
    return <LoginClient />
}
