import type { Prisma, PrismaClient, RequestStatus, ServiceRequest } from '@prisma/client'

/**
 * Where a later layer attaches to a filing, without Layer 0 knowing it exists.
 *
 * The filing route belongs to the baseline, and the baseline has to stay
 * measurable without anything this project adds (N5). But a later layer can
 * need to act on every new request inside the filing transaction itself — Layer
 * 1 has to leave each one with an accountable person, with no window in which it
 * is open and nobody's. So the route runs whatever has been registered here and
 * knows nothing about what that is; `app.ts` is the one place a layer is wired
 * in, and removing that line gives you the unmodified baseline back.
 *
 * Registered by name, so composing the app twice — which every test file does —
 * does not register the same hook twice and act on each filing twice.
 *
 * A hook that throws fails the filing. That is deliberate: a hook that wants to
 * be best-effort has to catch its own errors and say so.
 */
export type FiledHook = (tx: Prisma.TransactionClient, request: ServiceRequest) => Promise<void>

const filedHooks = new Map<string, FiledHook>()

export function onFiled(name: string, hook: FiledHook): void {
  filedHooks.set(name, hook)
}

export async function runFiledHooks(
  tx: Prisma.TransactionClient,
  request: ServiceRequest,
): Promise<void> {
  for (const hook of filedHooks.values()) await hook(tx, request)
}

/**
 * The same arrangement for status changes.
 *
 * Closing a request is a Layer 0 act, and a later layer can have work of its own
 * hanging off the request that closing should settle — jobs still out on the
 * street, for one. The transition runs these inside its own transaction and
 * knows nothing about what they are, exactly as filing does.
 */
export interface StatusChange {
  request: ServiceRequest
  from: RequestStatus
  to: RequestStatus
  at: Date
  actorId: number | null
  actorLabel: string
}

export type StatusChangedHook = (tx: Prisma.TransactionClient, change: StatusChange) => Promise<void>

const statusHooks = new Map<string, StatusChangedHook>()

export function onStatusChanged(name: string, hook: StatusChangedHook): void {
  statusHooks.set(name, hook)
}

export async function runStatusChangedHooks(
  tx: Prisma.TransactionClient,
  change: StatusChange,
): Promise<void> {
  for (const hook of statusHooks.values()) await hook(tx, change)
}

/**
 * One step in a request's progress, as the public request page shows it.
 *
 * Described by role, never by name: the page is public, and "an officer is
 * answering for it" tells a resident what they need without publishing who.
 */
export interface ProgressStep {
  /** Stable, for ordering ties and for tests. */
  key: string
  label: string
  at: Date
  detail?: string | null
}

export type ProgressDescriber = (
  db: Prisma.TransactionClient | PrismaClient,
  request: ServiceRequest,
) => Promise<ProgressStep[]>

const describers = new Map<string, ProgressDescriber>()

/**
 * Let a layer add the steps it knows about to a request's progress.
 *
 * The same shape as the hooks above, for the same reason: the baseline can say
 * a request was filed and closed, and nothing else, without knowing that later
 * layers assign officers, send crews or escalate.
 */
export function onDescribeProgress(name: string, describer: ProgressDescriber): void {
  describers.set(name, describer)
}

export async function describeProgress(
  db: Prisma.TransactionClient | PrismaClient,
  request: ServiceRequest,
): Promise<ProgressStep[]> {
  const steps: ProgressStep[] = []
  for (const describer of describers.values()) steps.push(...(await describer(db, request)))
  return steps.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key))
}
