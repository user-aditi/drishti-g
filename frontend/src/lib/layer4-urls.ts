import { BROWSER_API } from './api-base'

/**
 * Where a photograph sent back from a job is served from.
 *
 * Deliberately not in `layer4-api.ts`: that module is `'use client'`, and a
 * server component importing from it gets a client reference rather than a
 * function — which fails at render time, not at build time. These are plain
 * strings needed on both sides, so they live where both sides can have them.
 *
 * The browser origin is used even on the server, because what is built here ends
 * up in an `img` tag that the reader's browser fetches.
 */

/** For the people in this system entitled to see it — carries the session. */
export const proofPhotoUrl = (storedName: string) =>
    `${BROWSER_API}/proof/photo/${encodeURIComponent(storedName)}`

/** The same photograph addressed by the job's code — how the crew sees it. */
export const crewPhotoUrl = (code: string, storedName: string) =>
    `${BROWSER_API}/work-orders/${encodeURIComponent(code)}/photo/${encodeURIComponent(storedName)}`
