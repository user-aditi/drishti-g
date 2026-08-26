'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ErrorBanner } from '@/components/shared/page-header'
import type { Sector } from '@/types'

export function RegisterClient({ sectors }: { sectors: Sector[] }) {
    const router = useRouter()
    const [form, setForm] = useState({
        fullName: '',
        email: '',
        phone: '',
        password: '',
        homeSectorId: '',
    })
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const update = (key: keyof typeof form, value: string) =>
        setForm((f) => ({ ...f, [key]: value }))

    async function submit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setSubmitting(true)
        try {
            await apiClient.register({
                fullName: form.fullName,
                email: form.email,
                password: form.password,
                phone: form.phone || undefined,
                homeSectorId: form.homeSectorId ? Number(form.homeSectorId) : null,
            })
            router.replace('/')
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not reach the server.'))
            setSubmitting(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="mb-6 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--primary)] text-lg font-bold text-white">
                        दृ
                    </div>
                    <h1 className="mt-3 text-xl font-bold">Create your account</h1>
                    <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                        Report civic issues and follow them through to resolution.
                    </p>
                </div>

                <Card className="p-6">
                    <form onSubmit={submit} className="space-y-4">
                        {error && <ErrorBanner message={error} />}

                        <div>
                            <Label htmlFor="fullName">Full name</Label>
                            <Input
                                id="fullName"
                                required
                                minLength={2}
                                placeholder="Meera Joshi"
                                value={form.fullName}
                                onChange={(e) => update('fullName', e.target.value)}
                            />
                        </div>

                        <div>
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                required
                                placeholder="you@example.com"
                                value={form.email}
                                onChange={(e) => update('email', e.target.value)}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <Label htmlFor="phone">
                                    Phone <span className="font-normal opacity-60">(optional)</span>
                                </Label>
                                <Input
                                    id="phone"
                                    placeholder="98765 43210"
                                    value={form.phone}
                                    onChange={(e) => update('phone', e.target.value)}
                                />
                            </div>

                            <div>
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    required
                                    minLength={8}
                                    placeholder="At least 8 characters"
                                    value={form.password}
                                    onChange={(e) => update('password', e.target.value)}
                                />
                            </div>
                        </div>

                        {sectors.length > 0 && (
                            <div>
                                <Label htmlFor="homeSectorId">
                                    Your sector <span className="font-normal opacity-60">(optional)</span>
                                </Label>
                                <Select
                                    id="homeSectorId"
                                    value={form.homeSectorId}
                                    onChange={(e) => update('homeSectorId', e.target.value)}
                                >
                                    <option value="">Select your sector</option>
                                    {sectors.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            Sector {s.number} — {s.name}
                                        </option>
                                    ))}
                                </Select>
                                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                    Used to route complaints when your phone cannot supply a location.
                                </p>
                            </div>
                        )}

                        <Button type="submit" className="w-full" disabled={submitting}>
                            {submitting && <Loader2 className="animate-spin" />}
                            {submitting ? 'Creating account…' : 'Create account'}
                        </Button>

                        <p className="text-center text-sm text-[color:var(--muted-foreground)]">
                            Already registered?
                            <Link
                                href="/login"
                                className="ml-1 font-medium text-[color:var(--primary)] hover:underline"
                            >
                                Sign in
                            </Link>
                        </p>
                    </form>
                </Card>
            </div>
        </div>
    )
}
