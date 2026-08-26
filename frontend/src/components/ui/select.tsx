import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A native select, deliberately.
 *
 * Officers use this on phones in the field, where the platform picker is faster
 * and more reliable than a custom listbox — and it needs no JavaScript.
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
    ({ className, children, ...props }, ref) => (
        <select
            ref={ref}
            className={cn(
                'flex h-10 w-full rounded-md border border-[color:var(--input)] bg-[color:var(--card)] px-3 py-2 text-sm',
                'focus-visible:border-[color:var(--primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]',
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
