import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
    <textarea
        ref={ref}
        className={cn(
            'flex min-h-20 w-full resize-y rounded-[var(--radius)] border border-line-strong bg-surface px-2.5 py-2 text-base text-ink',
            'placeholder:text-ink-soft',
            'focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand',
            'disabled:cursor-not-allowed disabled:opacity-60',
            className,
        )}
        {...props}
    />
))
Textarea.displayName = 'Textarea'

export { Textarea }
