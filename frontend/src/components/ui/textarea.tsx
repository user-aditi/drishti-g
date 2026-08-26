import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
    <textarea
        ref={ref}
        className={cn(
            'flex min-h-[80px] w-full resize-y rounded-md border border-[color:var(--input)] bg-[color:var(--card)] px-3 py-2 text-sm',
            'placeholder:text-[color:var(--muted-foreground)]',
            'focus-visible:border-[color:var(--primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
            className,
        )}
        {...props}
    />
))
Textarea.displayName = 'Textarea'

export { Textarea }
