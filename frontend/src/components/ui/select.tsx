import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A native select, deliberately.
 *
 * The platform picker is keyboard-operable and screen-reader-correct on every
 * device without any work from us, which a custom listbox is not. This is a
 * public service: the person filing on a six-year-old phone with the screen
 * reader on is not an edge case, they are the point.
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
    ({ className, children, ...props }, ref) => (
        <select
            ref={ref}
            className={cn(
                'flex h-9 w-full rounded-[var(--radius)] border border-line-strong bg-surface px-2 text-base text-ink',
                'focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand',
                'disabled:cursor-not-allowed disabled:opacity-60',
                className,
            )}
            {...props}
        >
            {children}
        </select>
    ),
)
Select.displayName = 'Select'

export { Select }
