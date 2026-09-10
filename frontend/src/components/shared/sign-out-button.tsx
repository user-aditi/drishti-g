'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

/**
 * Signing out has to clear the cookie on the server and then make the server
 * components re-run, or the header keeps showing a name for a session that no
 * longer exists. Hence `refresh()` after the navigation rather than a push
 * alone: the guards live on the server, so the server has to be asked again.
 */
export function SignOutButton() {
    const router = useRouter()
    const [busy, setBusy] = useState(false)

    async function signOut() {
        setBusy(true)
        try {
            await apiClient.logout()
        } catch {
            // A failed sign-out still means the person wants to leave; sending
            // them to the public page and re-reading the session is the honest
            // outcome either way.
        }
        router.replace('/')
        router.refresh()
    }

    return (
        <Button variant="outline" size="sm" onClick={signOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
        </Button>
    )
}
