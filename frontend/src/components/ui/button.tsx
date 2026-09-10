import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Buttons are outlined, not shadowed.
 *
 * This whole interface is built out of 1px lines, and a button that floats
 * above the page reads as a different design language from the register it
 * sits on top of. The primary action gets the institutional blue; everything
 * else is a line.
 */
const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    {
        variants: {
            variant: {
                primary: 'bg-brand text-white hover:opacity-90',
                outline:
                    'border border-line-strong bg-surface text-ink hover:bg-sunk',
                quiet: 'text-ink-mid hover:bg-sunk hover:text-ink',
                link: 'text-brand underline-offset-4 hover:underline',
                danger: 'border border-stop bg-transparent text-stop hover:bg-stop-soft',
            },
            size: {
                default: 'h-9 px-4 text-base',
                sm: 'h-8 px-3 text-sm',
                lg: 'h-11 px-6 text-lg',
                icon: 'h-9 w-9',
            },
        },
        defaultVariants: { variant: 'primary', size: 'default' },
    },
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button'
        return (
            <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
        )
    },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
