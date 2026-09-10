'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { homeFor } from '@/lib/routes'
import { SEED_ACCOUNTS, SEED_PASSWORD } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel, PanelBody } from '@/components/ui/card'
import { ErrorNotice } from '@/components/shared/notices'
import { Spinner } from '@/components/ui/spinner'
import {
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'

export function LoginForm() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    async function submit(event: FormEvent) {
        event.preventDefault()
        setError(null)
        setSubmitting(true)
        try {
            const result = await apiClient.login(email, password)
            // The session lives in an httpOnly cookie that the server layouts
            // read, so the server has to be asked again — refreshing on a stale
            // client tree would land on a guard that has not seen the cookie.
            router.replace(homeFor(result.user.role))
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not reach the service. Check that the API is running.'))
            setSubmitting(false)
        }
    }

    function fill(demoEmail: string) {
        setEmail(demoEmail)
        setPassword(SEED_PASSWORD)
        setError(null)
    }

    return (
        <div className="flex flex-col gap-6">
            <Panel>
                <PanelBody>
                    <form onSubmit={submit} className="flex flex-col gap-4">
                        {error && <ErrorNotice title="Could not sign in" message={error} />}

                        <div>
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                required
                                autoComplete="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                            />
                        </div>

                        <div>
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                required
                                autoComplete="current-password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                            />
                        </div>

                        <Button type="submit" disabled={submitting} className="self-start">
                            {submitting && <Spinner />}
                            {submitting ? 'Signing in…' : 'Sign in'}
                        </Button>

                        <p className="text-base text-ink-mid">
                            No account?{' '}
                            <Link href="/register" className="text-brand underline underline-offset-2">
                                Create one
                            </Link>
                            . Staff accounts are issued, not self-registered.
                        </p>
                    </form>
                </PanelBody>
            </Panel>

            {/*
             * The seeded accounts, as a register rather than a row of cards.
             * They are meant to be compared — which agency, which queue — and a
             * table is what comparison looks like.
             *
             * Every one of these stands in for a role NYC does not publish.
             * There is no case-worker identity anywhere in the 311 data, so an
             * "agent" here is a fixture this project invented to have somebody
             * to work a queue, and the domain says as much: `.invalid` is
             * reserved by RFC 2606 and can never reach a real inbox.
             */}
            <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-ink">Seeded accounts</h2>
                <p className="prose-measure text-base text-ink-mid">
                    Fixtures for reviewing the replica. Each stands in for a role the published 311
                    data does not record, and none belongs to a real person. Select one to fill the
                    form; they all share the password{' '}
                    <span className="mono text-ink">{SEED_PASSWORD}</span>.
                </p>

                <RegisterFrame>
                    <RegisterTable caption="Seeded accounts — select one to fill the sign-in form">
                        <RegisterHead>
                            <Th>Account</Th>
                            <Th>Email</Th>
                            <Th>Works on</Th>
                            <Th />
                        </RegisterHead>
                        <RegisterBody>
                            {SEED_ACCOUNTS.map((account) => (
                                <Tr key={account.email}>
                                    <Td className="text-ink">{account.label}</Td>
                                    <Td mono>{account.email}</Td>
                                    <Td>{account.hint}</Td>
                                    <Td align="right">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fill(account.email)}
                                        >
                                            Use
                                        </Button>
                                    </Td>
                                </Tr>
                            ))}
                        </RegisterBody>
                    </RegisterTable>
                </RegisterFrame>
            </section>
        </div>
    )
}
