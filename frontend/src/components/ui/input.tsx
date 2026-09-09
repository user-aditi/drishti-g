import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, type, ...props }, ref) => (
        <input
            type={type}
            ref={ref}
            className={cn(
                'flex h-10 w-full rounded-[var(--radius-lg)] border border-[color:var(--input)] bg-[color:var(--card)] px-3 py-2 text-sm shadow-[var(--shadow-xs)] transition-colors',
                'placeholder:text-[color:var(--subtle-foreground)]',
                'focus-visible:border-[color:var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]/25',
                'disabled:cursor-not-allowed disabled:opacity-60',
                'file:border-0 file:bg-transparent file:text-sm file:font-medium',
                className,
            )}
            {...props}
        />
    ),
)
Input.displayName = 'Input'

export { Input }
