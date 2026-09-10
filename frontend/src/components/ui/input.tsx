import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, type, ...props }, ref) => (
        <input
            type={type}
            ref={ref}
            className={cn(
                'flex h-9 w-full rounded-[var(--radius)] border border-line-strong bg-surface px-2.5 text-base text-ink',
                'placeholder:text-ink-soft',
                'focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand',
                'disabled:cursor-not-allowed disabled:opacity-60',
                className,
            )}
            {...props}
        />
    ),
)
Input.displayName = 'Input'

export { Input }
