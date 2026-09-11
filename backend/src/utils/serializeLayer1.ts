import type { Prisma } from '@prisma/client'
import { stateOf } from '../services/workOrder.js'
import { publicRequest } from './serialize.js'

/**
 * A service request as Layer 1 reports it: the Layer 0 record, plus who answers
 * for it and the job currently out on it.
 *
 * Kept out of `serialize.ts` on purpose. That file is the baseline's, and the
 * baseline is not allowed to know officers exist (N5); this one extends it
 * rather than editing it, so deleting Layer 1 leaves Layer 0 byte-identical.
 */
export const LAYER1_INCLUDE = {
  type: { include: { agency: true } },
  descriptor: true,
  agency: true,
  orgUnit: true,
  assignedOfficer: true,
  workOrders: { orderBy: { issuedAt: 'desc' as const } },
} satisfies Prisma.ServiceRequestInclude

export type Layer1Request = Prisma.ServiceRequestGetPayload<{ include: typeof LAYER1_INCLUDE }>

export function layer1Request(request: Layer1Request, referenceDate: Date) {
  const now = new Date()
  return {
    ...publicRequest(request, referenceDate),
    // Every officer is synthetic — NYC records no case-worker identity — and
    // the flag travels with the name so no screen can show one without it.
    accountable: request.assignedOfficer
      ? {
          id: request.assignedOfficer.id,
          name: request.assignedOfficer.name,
          isSynthetic: request.assignedOfficer.isSynthetic,
        }
      : null,
    assignedAt: request.assignedAt,
    workOrders: request.workOrders.map((order) => ({
      id: order.id,
      code: order.code,
      instructions: order.instructions,
      issuedAt: order.issuedAt,
      expiresAt: order.expiresAt,
      completedAt: order.completedAt,
      completionNote: order.completionNote,
      // Expiry is wall-clock: a credential's lifetime is a question about now,
      // not about the snapshot the record was observed at.
      state: stateOf(order, now),
    })),
  }
}
