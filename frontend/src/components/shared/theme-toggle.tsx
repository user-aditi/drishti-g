'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

type Choice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'drishti-theme'

/**
 * The boot script, inlined into the document head.
 *
 * Theme has to be resolved before the first paint or the officer gets a white
 * flash on every navigation, which on a dark-mode desk at night is genuinely
 * unpleasant. This runs synchronously, ahead of React, and only ever adds or
 * removes one class.
 */
export const THEME_BOOT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var dark = stored === 'dark' || ((!stored || stored === 'system') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`

function apply(choice: Choice) {
    const dark =
        choice === 'dark' ||
        (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
}

const OPTIONS: { value: Choice; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
]

/**
 * Light, dark, or whatever the machine says.
 *
 * "System" is the default rather than light, because a municipal officer's
 * desktop policy is not this app's business to override.
 */
export function ThemeToggle({ className }: { className?: string }) {
    const [choice, setChoice] = useState<Choice>('system')
    const [ready, setReady] = useState(false)

    useEffect(() => {
        const stored = (localStorage.getItem(STORAGE_KEY) as Choice | null) ?? 'system'
        setChoice(stored)
        setReady(true)
    }, [])

    // Following the machine means following it as it changes, not only at boot.
    useEffect(() => {
        if (choice !== 'system') return
        const media = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = () => apply('system')
        media.addEventListener('change', onChange)
        return () => media.removeEventListener('change', onChange)
    }, [choice])

    function pick(next: Choice) {
        setChoice(next)
        localStorage.setItem(STORAGE_KEY, next)
        apply(next)
    }

    return (
        <div
            role="group"
            aria-label="Colour theme"
            className={cn(
                'inline-flex items-center gap-0.5 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--sunken)] p-0.5',
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
                            'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] transition-colors',
                            active
                                ? 'bg-[color:var(--card)] text-[color:var(--foreground)] shadow-[var(--shadow-xs)]'
                                : 'text-[color:var(--subtle-foreground)] hover:text-[color:var(--foreground)]',
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
