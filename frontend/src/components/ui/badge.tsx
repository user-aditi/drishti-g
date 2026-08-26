import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
    {
        variants: {
            variant: {
                default: 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
                neutral: 'bg-slate-100 text-slate-700',
                outline: 'border border-[color:var(--border)] text-[color:var(--muted-foreground)]',
                success: 'bg-emerald-100 text-emerald-800',
                warning: 'bg-amber-100 text-amber-800',
                danger: 'bg-red-100 text-red-800',
                info: 'bg-sky-100 text-sky-800',
                purple: 'bg-purple-100 text-purple-800',
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
