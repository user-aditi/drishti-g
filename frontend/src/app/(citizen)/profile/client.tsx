'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, CircleCheck, Loader2, MapPin, Users } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ErrorBanner, SectionHeading } from '@/components/shared/page-header'
import { RANK_STYLE } from '@/lib/constants'
import { initials } from '@/lib/format'
import type { Area, CitizenContacts, CitizenProfile } from '@/types'

export function ProfileClient({
    profile,
    areas,
    contacts,
    currentName,
}: {
    profile: CitizenProfile
    areas: Area[]
    contacts: CitizenContacts
    currentName: string
}) {
    const router = useRouter()
    const [form, setForm] = useState({
        fullName: profile.user.fullName,
        phone: profile.user.phone ?? '',
        homeUnitId: profile.user.homeUnitId ? String(profile.user.homeUnitId) : '',
    })
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)
        setSaved(false)
        try {
            await apiClient.updateProfile({
                fullName: form.fullName,
                phone: form.phone || null,
                homeUnitId: form.homeUnitId ? Number(form.homeUnitId) : null,
            })
            setSaved(true)
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not save your details.'))
        } finally {
            setSaving(false)
        }
    }

    const { activity, home } = profile

    return (
        <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
                <Card className="p-5">
                    <SectionHeading
                        title="Your details"
                        description="The sector you choose decides which officer answers for you, which grievances you can back, and which works you are shown."
                    />

                    {error && <ErrorBanner message={error} />}
                    {saved && !error && (
                        <p className="mb-4 flex items-center gap-2 rounded-lg border border-[color:var(--success-border)] bg-[color:var(--success-bg)] px-3 py-2 text-sm text-[color:var(--success-fg)]">
                            <CircleCheck className="h-4 w-4" aria-hidden />
                            Saved.
                        </p>
                    )}

                    <form onSubmit={submit} className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <Label htmlFor="fullName">Full name</Label>
                                <Input
                                    id="fullName"
                                    required
                                    minLength={2}
                                    value={form.fullName}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, fullName: e.target.value }))
                                    }
                                />
                            </div>
                            <div>
                                <Label htmlFor="phone">Phone</Label>
                                <Input
                                    id="phone"
                                    type="tel"
                                    maxLength={20}
                                    placeholder="Optional"
                                    value={form.phone}
                                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                                />
                                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                    Only shared with the officer handling your complaint.
                                </p>
                            </div>
                            <div className="sm:col-span-2">
                                <Label htmlFor="homeUnitId">Where do you live?</Label>
                                <Select
                                    id="homeUnitId"
                                    value={form.homeUnitId}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, homeUnitId: e.target.value }))
                                    }
                                >
                                    <option value="">Not set</option>
                                    {areas.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <Button type="submit" disabled={saving}>
                                {saving && <Loader2 className="animate-spin" />}
                                Save changes
                            </Button>
                            <span className="text-xs text-[color:var(--muted-foreground)]">
                                Signed in as {profile.user.email}
                            </span>
                        </div>
                    </form>
                </Card>

                {contacts.departments.length > 0 && (
                    <Card className="p-5">
                        <SectionHeading
                            title="Who answers for your sector"
                            description="The officer to approach first in each department. Not the crew who do the work — the person accountable for it."
                            action={
                                <Button asChild variant="outline" size="sm">
                                    <Link href="/contacts">
                                        See the full chain
                                        <ArrowRight />
                                    </Link>
                                </Button>
                            }
                        />
                        <ul className="divide-y divide-[color:var(--border)]">
                            {contacts.departments.map(({ department, directHead }) => (
                                <li
                                    key={department.id}
                                    className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                                >
                                    <span
                                        aria-hidden
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-[10px] font-semibold text-[color:var(--accent-foreground)]"
                                    >
                                        {initials(directHead.fullName)}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">{directHead.fullName}</p>
                                        <p className="text-xs text-[color:var(--muted-foreground)]">
                                            {department.icon} {department.name}
                                        </p>
                                    </div>
                                    <Badge className={RANK_STYLE[directHead.rank]}>
                                        {directHead.designationTitle}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}
            </div>

            <aside className="space-y-5">
                <Card className="p-5">
                    <div className="flex items-center gap-3">
                        <span
                            aria-hidden
                            className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--primary)] text-sm font-semibold text-white"
                        >
                            {initials(currentName)}
                        </span>
                        <div className="min-w-0">
                            <p className="truncate font-semibold">{profile.user.fullName}</p>
                            <p className="truncate text-xs text-[color:var(--muted-foreground)]">
                                {profile.user.email}
                            </p>
                        </div>
                    </div>

                    {home ? (
                        <p className="mt-4 flex items-start gap-2 rounded-lg bg-[color:var(--muted)] px-3 py-2.5 text-sm">
                            <MapPin
                                className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]"
                                aria-hidden
                            />
                            <span>
                                <span className="font-medium">
                                    {home.unitKind} {home.unitName}
                                </span>
                                <span className="block text-xs text-[color:var(--muted-foreground)]">
                                    {/* Root first, so the reader sees where their
                                        street sits in the whole authority. */}
                                    {home.trail
                                        .slice(0, -1)
                                        .map((t) => t.name)
                                        .join(' · ')}
                                </span>
                            </span>
                        </p>
                    ) : (
                        <p className="mt-4 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-3 py-2.5 text-xs text-[color:var(--warning-fg)]">
                            You have not set your sector yet, so we cannot tell you who answers for
                            your street.
                        </p>
                    )}
                </Card>

                <Card className="p-5">
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                        Your activity
                    </h2>
                    <dl className="space-y-2.5 text-sm">
                        <Row label="Issues reported" value={activity.filed} />
                        <Row label="Still open" value={activity.open} />
                        <Row label="Resolved" value={activity.resolved} />
                        <Row
                            label="Neighbours' issues you backed"
                            value={activity.supported}
                            icon={<Users className="h-3.5 w-3.5" aria-hidden />}
                        />
                        {activity.avgRatingGiven != null && (
                            <Row
                                label="Average rating you gave"
                                value={`${activity.avgRatingGiven.toFixed(1)} / 5`}
                            />
                        )}
                    </dl>
                </Card>
            </aside>
        </div>
    )
}

function Row({
    label,
    value,
    icon,
}: {
    label: string
    value: number | string
    icon?: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-[color:var(--muted-foreground)]">
                {icon}
                {label}
            </dt>
            <dd className="tnum font-semibold">{value}</dd>
        </div>
    )
}
