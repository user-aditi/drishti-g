import type { ReactNode } from 'react'
import { BAND_META, PRIORITY_META, STATUS_META } from '../lib/format'
import type { ComplaintStatus, Priority, RiskBand } from '../lib/types'

export function StatusPill({ status }: { status: ComplaintStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={`pill ${meta.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority]
  return <span className={`pill ${meta.className}`}>{meta.label}</span>
}

export function RiskBadge({ band, score }: { band: RiskBand; score?: number }) {
  const meta = BAND_META[band]
  return (
    <span className={`pill ${meta.className}`}>
      {score !== undefined && <span className="tnum font-semibold">{Math.round(score)}</span>}
      {meta.label}
    </span>
  )
}

/**
 * A 0-100 risk score as a filled arc.
 *
 * Deliberately not a plain number: the band colour and the fill carry the
 * severity at a glance, and the number stays for anyone who needs the value.
 */
export function RiskDial({ score, band, size = 96 }: { score: number; band: RiskBand; size?: number }) {
  const meta = BAND_META[band]
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference

  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className={meta.text}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`tnum text-xl font-bold ${meta.text}`}>{Math.round(score)}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {meta.label}
        </span>
      </div>
    </div>
  )
}

interface StatTileProps {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
  icon?: ReactNode
}

export function StatTile({ label, value, hint, tone = 'default', icon }: StatTileProps) {
  const toneClass = {
    default: 'text-slate-900',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    success: 'text-emerald-600',
  }[tone]

  return (
    <div className="card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`tnum mt-2 text-3xl font-bold leading-none ${toneClass}`}>{value}</p>
          {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
        </div>
        {icon && <div className="shrink-0 text-slate-300">{icon}</div>}
      </div>
    </div>
  )
}

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
      <div className="text-4xl" aria-hidden>
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
    >
      <span aria-hidden className="mt-0.5 text-red-500">
        ⚠
      </span>
      <div className="flex-1 text-sm text-red-800">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="btn-sm btn text-red-700 hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card-pad space-y-3">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {action}
    </header>
  )
}
