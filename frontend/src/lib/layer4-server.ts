import { serverFetch } from './api'
import type { CitizenQuestion, ProofQueue } from '@/types/layer4'

/** Layer 4's server-side reads, kept apart from the layers below it. */
export const getProofQueue = () => serverFetch<ProofQueue>('/proof/queue')

/**
 * What the signed-in resident is being asked about this request, or null.
 *
 * Null is the ordinary answer: for anyone who did not report it, and for every
 * request where no crew is waiting on a verdict.
 */
export const getCitizenQuestion = (srNumber: string) =>
    serverFetch<CitizenQuestion | null>(`/proof/request/${encodeURIComponent(srNumber)}`)
