'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { homeFor } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Panel, PanelBody } from '@/components/ui/card'
import { ErrorNotice, InfoNotice } from '@/components/shared/notices'
import { Spinner } from '@/components/ui/spinner'
import type { Area } from '@/types'

/**
 * Self-registration always produces a member of the public.
 *
 * There is no role picker, and that is a decision rather than an omission: an
 * agency queue is not something anybody may sign themselves into. Staff
 * accounts are seeded. The API enforces the same rule, so the two cannot drift.
 */
export function RegisterForm({ areas }: { areas: Area[] }) {
    const router = useRouter()
    const [form, setForm] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        orgUnitId: '',
    })
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const update = (key: keyof typeof form, value: string) =>
        setForm((current) => ({ ...current, [key]: value }))

    async function submit(event: FormEvent) {
        event.preventDefault()
        setError(null)
        setSubmitting(true)
        try {
            const result = await apiClient.register({
                name: form.name,
                email: form.email,
                password: form.password,
                phone: form.phone || undefined,
                orgUnitId: form.orgUnitId ? Number(form.orgUnitId) : null,
            })
            router.replace(homeFor(result.user.role))
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not reach the service. Check that the API is running.'))
            setSubmitting(false)
        }
    }

    return (
        <Panel>
            <PanelBody>
                <form onSubmit={submit} className="flex flex-col gap-4">
                    {error && <ErrorNotice title="Could not create the account" message={error} />}

                    <div>
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            required
                            minLength={2}
                            autoComplete="name"
                            value={form.name}
                            onChange={(event) => update('name', event.target.value)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            required
                            autoComplete="email"
                            value={form.email}
                            onChange={(event) => update('email', event.target.value)}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                required
                                minLength={8}
                                autoComplete="new-password"
                                placeholder="At least 8 characters"
                                value={form.password}
                                onChange={(event) => update('password', event.target.value)}
                            />
                        </div>
                        <div>
                            <Label htmlFor="phone">
                                Phone <span className="font-normal text-ink-soft">(optional)</span>
                            </Label>
                            <Input
                                id="phone"
                                type="tel"
                                autoComplete="tel"
                                value={form.phone}
                                onChange={(event) => update('phone', event.target.value)}
                            />
                        </div>
                    </div>

                    {areas.length > 0 && (
                        <div>
                            <Label htmlFor="orgUnitId">
                                Community board{' '}
                                <span className="font-normal text-ink-soft">(optional)</span>
                            </Label>
                            <Select
                                id="orgUnitId"
                                value={form.orgUnitId}
                                onChange={(event) => update('orgUnitId', event.target.value)}
                            >
                                <option value="">Prefer not to say</option>
                                {areas.map((area) => (
                                    <option key={area.id} value={area.id}>
                                        {area.code} — {area.name}
                                    </option>
                                ))}
                            </Select>
                            <p className="mt-1 text-sm text-ink-soft">
                                Used only to pre-fill the intake form. It does not restrict what you
                                can report or where.
                            </p>
                        </div>
                    )}

                    <InfoNotice>
                        This account exists inside an academic replica of NYC 311. It is not a City
                        of New York account, and nothing filed under it reaches the City. Use an
                        email address you do not mind giving to a university project.
                    </InfoNotice>

                    <Button type="submit" disabled={submitting} className="self-start">
                        {submitting && <Spinner />}
                        {submitting ? 'Creating account…' : 'Create account'}
                    </Button>

                    <p className="text-base text-ink-mid">
                        Already have one?{' '}
                        <Link href="/login" className="text-brand underline underline-offset-2">
                            Sign in
                        </Link>
                    </p>
                </form>
            </PanelBody>
        </Panel>
    )
}
