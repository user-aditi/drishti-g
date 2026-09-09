'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/shared/surface'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorBanner } from '@/components/shared/page-header'

export function LoginClient() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setSubmitting(true)
        try {
            await apiClient.login(email, password)
            // The session lives in an httpOnly cookie the server layouts read,
            // so refresh rather than navigating on stale client state.
            router.replace('/')
            router.refresh()
        } catch (err) {
            setError(
                messageFrom(err, 'Could not reach the server. Check that the API is running on port 4000.'),
            )
            setSubmitting(false)
        }
    }

    function useDemo(demoEmail: string) {
        setEmail(demoEmail)
        setPassword(DEMO_PASSWORD)
        setError(null)
    }

    return (
        <div className="grid min-h-screen lg:grid-cols-2">
            {/* Left: the pitch. Hidden where the form is all that matters. */}
            <div className="relative hidden flex-col justify-between bg-[color:var(--sidebar)] p-12 lg:flex">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-xl)] bg-[color:var(--primary)] font-bold text-white">
                        दृ
                    </div>
                    <div>
                        <div className="font-display font-bold tracking-tight text-white">DRISHTI-G</div>
                        <div className="text-xs uppercase tracking-wide text-[color:var(--sidebar-muted)]">
                            NOIDA Authority
                        </div>
                    </div>
                </div>

                <div className="max-w-md">
                    <h1 className="text-3xl font-semibold leading-tight text-white">
                        One coordinator. One risk radar that explains itself.
                    </h1>
                    <p className="mt-4 leading-relaxed text-[color:var(--sidebar-foreground)]">
                        Every complaint travels the authority&apos;s real chain of command — Junior Engineer
                        to Executive Engineer to General Manager — so nothing falls between departments,
                        and problems surface before they become expensive.
                    </p>

                    <dl className="mt-10 space-y-5">
                        <div className="border-l-2 border-[color:var(--primary)] pl-4">
                            <dt className="text-sm font-semibold text-white">GCCE — the coordinator</dt>
                            <dd className="mt-0.5 text-sm text-[color:var(--sidebar-muted)]">
                                Routes every complaint to the officer responsible for that sector, and
                                escalates it upward when a deadline is missed.
                            </dd>
                        </div>
                        <div className="border-l-2 border-[color:var(--primary)] pl-4">
                            <dt className="text-sm font-semibold text-white">GRIE — the risk radar</dt>
                            <dd className="mt-0.5 text-sm text-[color:var(--sidebar-muted)]">
                                Scores every unit of the authority, at any depth — and always shows
                                its reasoning.
                            </dd>
                        </div>
                    </dl>
                </div>

                <p className="text-xs text-[color:var(--sidebar-muted)]">
                    Capstone project · New Okhla Industrial Development Authority
                </p>
            </div>

            {/* Right: the form. */}
            <div className="flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-sm">
                    <div className="mb-8 text-center lg:hidden">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--radius-xl)] bg-[color:var(--primary)] text-lg font-bold text-white">
                            दृ
                        </div>
                        <h1 className="mt-3 text-xl font-semibold">DRISHTI-G</h1>
                        <p className="text-sm text-[color:var(--muted-foreground)]">NOIDA Authority</p>
                    </div>

                    <Panel className="p-6">
                        <form onSubmit={submit} className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold">Sign in</h2>
                                <p className="mt-0.5 text-sm text-[color:var(--muted-foreground)]">
                                    Access your authority account
                                </p>
                            </div>

                            {error && <ErrorBanner message={error} />}

                            <div>
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    required
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>

                            <div>
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    required
                                    autoComplete="current-password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>

                            <Button type="submit" className="w-full" disabled={submitting}>
                                {submitting && <Loader2 className="animate-spin" />}
                                {submitting ? 'Signing in…' : 'Sign in'}
                            </Button>

                            <p className="text-center text-sm text-[color:var(--muted-foreground)]">
                                New here?
                                <Link
                                    href="/register"
                                    className="ml-1 font-medium text-[color:var(--primary)] hover:underline"
                                >
                                    Create a citizen account
                                </Link>
                            </p>
                        </form>
                    </Panel>

                    <div className="mt-6">
                        <p className="label-cap mb-2 text-center">Demo accounts</p>

                        {/* Five accounts, each with the same two facts: what they
                            are and what they can see. That is a table, and as a
                            table a reviewer can compare the layers of the
                            authority instead of reading five paragraphs. */}
                        <Panel flush>
                            <table className="w-full border-collapse text-left text-sm">
                                <caption className="sr-only">
                                    Demo accounts — choose one to fill the sign-in form
                                </caption>
                                <tbody className="divide-y divide-[color:var(--border)]">
                                    {DEMO_ACCOUNTS.map((account) => (
                                        <tr
                                            key={account.email}
                                            className="cursor-pointer transition-colors hover:bg-[color:var(--sunken)]"
                                            onClick={() => useDemo(account.email)}
                                        >
                                            <td className="py-2.5 pl-3 pr-2">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        useDemo(account.email)
                                                    }}
                                                    className="block text-left"
                                                >
                                                    <span className="block text-xs font-semibold">
                                                        {account.label}
                                                    </span>
                                                    <span className="mt-0.5 block text-[11px] leading-snug text-[color:var(--muted-foreground)]">
                                                        {account.hint}
                                                    </span>
                                                </button>
                                            </td>
                                            <td className="w-8 pr-3 text-right">
                                                <ArrowRight
                                                    className="inline h-3.5 w-3.5 text-[color:var(--primary)]"
                                                    aria-hidden
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>

                        <p className="mt-2 text-center text-[11px] text-[color:var(--muted-foreground)]">
                            All demo accounts use the password{' '}
                            <code className="font-mono">{DEMO_PASSWORD}</code>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
