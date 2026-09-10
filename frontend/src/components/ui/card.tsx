import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A panel: one line, one radius, no shadow.
 *
 * Panels frame a *detail* — one request, one board, one form. Lists never use
 * them: a list of requests is a register, and cutting it into cards throws away
 * the column alignment that makes three hundred rows comparable at a glance.
 */
const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn('rounded-[var(--radius)] border border-line bg-surface', className)}
            {...props}
        />
    ),
)
Panel.displayName = 'Panel'

const PanelHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                'flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3',
                className,
            )}
            {...props}
        />
    ),
)
PanelHeader.displayName = 'PanelHeader'

const PanelTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h2 ref={ref} className={cn('text-lg font-semibold text-ink', className)} {...props} />
    ),
)
PanelTitle.displayName = 'PanelTitle'

const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4', className)} {...props} />,
)
PanelBody.displayName = 'PanelBody'

export { Panel, PanelHeader, PanelTitle, PanelBody }
