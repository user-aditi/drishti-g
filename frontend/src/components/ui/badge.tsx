import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * A badge is a square-cornered tag, not a pill of colour.
 *
 * Every variant draws from the status families in globals.css, so a "stop"
 * badge is the same red as an overdue row and an overdue map dot. Nothing here
 * names a raw colour, and there is deliberately no brand variant — the
 * institutional blue is chrome, never a state.
 */
const badgeVariants = cva(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border px-2 py-0.5 text-xs font-medium',
    {
        variants: {
            tone: {
                neutral: 'border-line bg-sunk text-ink-mid',
                wait: 'border-wait/35 bg-wait-soft text-wait',
                done: 'border-done/35 bg-done-soft text-done',
                stop: 'border-stop/35 bg-stop-soft text-stop',
                outline: 'border-line-strong bg-transparent text-ink-soft',
            },
        },
        defaultVariants: { tone: 'neutral' },
    },
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
