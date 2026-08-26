import type { ReactNode } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'warning' | 'danger' | 'success' | 'purple'

const TONE_CLASS: Record<Tone, string> = {
    default: 'text-[color:var(--foreground)]',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    success: 'text-emerald-600',
    purple: 'text-purple-700',
}

export function StatTile({
    label,
    value,
    hint,
    tone = 'default',
    icon,
    href,
}: {
    label: string
    value: ReactNode
    hint?: string
    tone?: Tone
    icon?: ReactNode
    /** Makes the whole tile a link — used where a number is really a queue. */
    href?: string
}) {
    const body = (
        <Card
            className={cn(
                'h-full p-5',
                href && 'transition-all hover:border-[color:var(--primary)] hover:shadow-md',
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                        {label}
                    </p>
                    <p className={cn('tnum mt-2 text-3xl font-bold leading-none', TONE_CLASS[tone])}>
                        {value}
                    </p>
                    {hint && (
                        <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">{hint}</p>
                    )}
                </div>
                {icon && <div className="shrink-0 text-slate-300">{icon}</div>}
            </div>
        </Card>
    )

    return href ? <Link href={href}>{body}</Link> : body
}
