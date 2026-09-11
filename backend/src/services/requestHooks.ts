import type { Prisma, ServiceRequest } from '@prisma/client'

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
