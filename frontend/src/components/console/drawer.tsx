'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The record panel.
 *
 * Opening a row must never cost the reader their place in the grid — they are
 * usually comparing one row against the ones around it. So a record opens
 * beside the table rather than navigating away from it, and closing returns
 * focus to where they were.
 */
/**
 * Open drawers, innermost last.
 *
 * Records nest — a staff file opens a transfer panel on top of itself — and one
 * Escape should close one panel, not the whole stack. Only the drawer on top
 * answers the key.
 */
const stack: symbol[] = []

export function Drawer({
    open,
    onClose,
    title,
    subtitle,
    badge,
    footer,
    width = 'md',
    children,
}: {
    open: boolean
    onClose: () => void
    title: ReactNode
    subtitle?: ReactNode
    badge?: ReactNode
    footer?: ReactNode
    width?: 'md' | 'lg'
    children: ReactNode
}) {
    const panelRef = useRef<HTMLDivElement>(null)
    const restoreFocusTo = useRef<Element | null>(null)
    const token = useRef<symbol>(Symbol('drawer'))

    useEffect(() => {
        if (!open) return

        restoreFocusTo.current = document.activeElement
        panelRef.current?.focus()

        const id = token.current
        stack.push(id)

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && stack[stack.length - 1] === id) onClose()
        }
        document.addEventListener('keydown', onKeyDown)

        // The grid behind must not scroll while a record is open, or closing the
        // panel lands the reader somewhere they never scrolled to.
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.body.style.overflow = previousOverflow
            const index = stack.indexOf(id)
            if (index !== -1) stack.splice(index, 1)
            if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus()
        }
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
                onClick={onClose}
                aria-hidden
            />

            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={typeof title === 'string' ? title : 'Record'}
                tabIndex={-1}
                className={cn(
                    'relative flex h-full w-full flex-col bg-[color:var(--card)] shadow-2xl outline-none',
                    width === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl',
                )}
            >
                <header className="flex items-start gap-3 border-b border-[color:var(--border)] px-5 py-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
                            {badge}
                        </div>
                        {subtitle && (
                            <p className="mt-0.5 truncate text-xs text-[color:var(--muted-foreground)]">
                                {subtitle}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                        aria-label="Close record"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

                {footer && (
                    <footer className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] bg-[color:var(--muted)]/40 px-5 py-3">
                        {footer}
                    </footer>
                )}
            </div>
        </div>
    )
}

/** A labelled block inside a record panel. */
export function DrawerSection({
    title,
    description,
    action,
    children,
}: {
    title: string
    description?: string
    action?: ReactNode
    children: ReactNode
}) {
    return (
        <section className="mb-6 last:mb-0">
            <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                        {title}
                    </h3>
                    {description && (
                        <p className="mt-0.5 text-xs text-[color:var(--muted-foreground)] opacity-80">
                            {description}
                        </p>
                    )}
                </div>
                {action}
            </div>
            {children}
        </section>
    )
}

/**
 * Read-only facts as label/value rows.
 *
 * Deliberately a definition list rather than a nested table: these are one
 * record's attributes, not a grid, and a screen reader should hear them paired.
 */
export function FactList({ items }: { items: { label: string; value: ReactNode }[] }) {
    return (
        <dl className="divide-y divide-[color:var(--border)] rounded-lg border border-[color:var(--border)]">
            {items.map((item) => (
                <div key={item.label} className="flex gap-3 px-3 py-2 text-sm">
                    <dt className="w-36 shrink-0 text-xs text-[color:var(--muted-foreground)]">
                        {item.label}
                    </dt>
                    <dd className="min-w-0 flex-1 break-words">{item.value}</dd>
                </div>
            ))}
        </dl>
    )
}
