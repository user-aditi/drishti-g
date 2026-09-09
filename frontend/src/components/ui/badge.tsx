import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Every badge draws from the semantic tone families in globals.css, so a
 * "danger" badge is the same red as a danger banner and a danger row tint, and
 * all three follow the theme into dark mode. Nothing here names a raw colour.
 */
const badgeVariants = cva(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5',
    {
        variants: {
            variant: {
                default:
                    'border-transparent bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
                neutral:
                    'border-transparent bg-[color:var(--neutral-bg)] text-[color:var(--neutral-fg)]',
                outline:
                    'border-[color:var(--border-strong)] bg-transparent text-[color:var(--muted-foreground)]',
                success:
                    'border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]',
                warning:
                    'border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]',
                danger: 'border-[color:var(--error-border)] bg-[color:var(--error-bg)] text-[color:var(--error-fg)]',
                info: 'border-[color:var(--info-border)] bg-[color:var(--info-bg)] text-[color:var(--info-fg)]',
                purple: 'border-[color:var(--escalate-border)] bg-[color:var(--escalate-bg)] text-[color:var(--escalate-fg)]',
                solid: 'border-transparent bg-[color:var(--primary)] text-[color:var(--primary-foreground)]',
            },
        },
        defaultVariants: { variant: 'default' },
    },
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
