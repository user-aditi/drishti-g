import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-lg)] text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0',
    {
        variants: {
            variant: {
                default:
                    'bg-[color:var(--primary)] text-[color:var(--primary-foreground)] shadow-[var(--shadow-xs)] hover:bg-[color:var(--primary-light)]',
                outline:
                    'border border-[color:var(--input)] bg-[color:var(--card)] text-[color:var(--foreground)] shadow-[var(--shadow-xs)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--sunken)]',
                secondary:
                    'bg-[color:var(--muted)] text-[color:var(--foreground)] hover:bg-[color:var(--border)]',
                ghost: 'text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]',
                destructive:
                    'bg-[color:var(--error)] text-white shadow-[var(--shadow-xs)] hover:opacity-90',
                success: 'bg-[color:var(--success)] text-white shadow-[var(--shadow-xs)] hover:opacity-90',
                link: 'text-[color:var(--primary)] underline-offset-4 hover:underline',
            },
            size: {
                default: 'h-10 px-4 py-2',
                sm: 'h-8 rounded-[var(--radius-md)] px-3 text-xs',
                lg: 'h-12 rounded-[var(--radius-lg)] px-6 text-base',
                icon: 'h-10 w-10',
                'icon-sm': 'h-8 w-8 rounded-[var(--radius-md)]',
            },
        },
        defaultVariants: { variant: 'default', size: 'default' },
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
        return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
