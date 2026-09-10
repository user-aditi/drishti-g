'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

type Choice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'layer0-theme'

/**
 * The boot script, inlined into the document head.
 *
 * The theme has to resolve before the first paint or every navigation flashes
 * white. This runs synchronously, ahead of React, and only ever sets or clears
 * one attribute — which is also why the palette keys off `data-theme` rather
 * than a class: `system` is the *absence* of the attribute, so the CSS media
 * query can own that case and this script does not have to ask the OS at all.
 */
export const THEME_BOOT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch (e) {}
})();
`

function apply(choice: Choice) {
    const root = document.documentElement
    if (choice === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', choice)
}

const OPTIONS: { value: Choice; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
]

/**
 * Light, dark, or whatever the machine says.
 *
 * "System" is the default rather than light, because a person's own display
 * settings are not this application's business to override.
 */
export function ThemeToggle({ className }: { className?: string }) {
    const [choice, setChoice] = useState<Choice>('system')
    const [ready, setReady] = useState(false)

    useEffect(() => {
        let stored: Choice = 'system'
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
            if (raw === 'dark' || raw === 'light') stored = raw
        } catch {
            // Storage blocked: system it is.
        }
        setChoice(stored)
        setReady(true)
    }, [])

    function pick(next: Choice) {
        setChoice(next)
        try {
            localStorage.setItem(STORAGE_KEY, next)
        } catch {
            // The choice still applies for this page load.
        }
        apply(next)
    }

    return (
        <div
            role="group"
            aria-label="Colour theme"
            className={cn(
                'inline-flex items-center rounded-[var(--radius)] border border-line bg-surface p-0.5',
                className,
            )}
        >
            {OPTIONS.map((opt) => {
                const active = ready && opt.value === choice
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => pick(opt.value)}
                        aria-pressed={active}
                        title={opt.label}
                        className={cn(
                            'inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius)] transition-colors',
                            active ? 'bg-sunk text-ink' : 'text-ink-soft hover:text-ink',
                        )}
                    >
                        <opt.icon className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">{opt.label}</span>
                    </button>
                )
            })}
        </div>
    )
}
