import type { Prisma } from '@prisma/client'
import { LEVEL_NAME } from '../services/escalation.js'
import { LAYER1_INCLUDE, layer1Request } from './serializeLayer1.js'

/**
 * A request as Layer 2 reports it: Layer 1's view, plus how far up the ladder it
 * has gone and every rung it climbed.
 *
 * Extends Layer 1's serializer rather than editing it, for the same reason Layer
 * 1 extends Layer 0's: each layer can be removed without touching the one below.
 */
export const LAYER2_INCLUDE = {
  ...LAYER1_INCLUDE,
  escalations: {
    orderBy: { at: 'asc' as const },
    include: {
      raisedBy: { select: { name: true, isSynthetic: true } },
      toUser: { select: { name: true, isSynthetic: true } },
      acknowledgedBy: { select: { name: true, isSynthetic: true } },
    },
  },
} satisfies Prisma.ServiceRequestInclude

export type Layer2Request = Prisma.ServiceRequestGetPayload<{ include: typeof LAYER2_INCLUDE }>

export function escalationView(escalation: Layer2Request['escalations'][number]) {
  return {
    id: escalation.id,
    fromLevel: escalation.fromLevel,
    toLevel: escalation.toLevel,
    toLevelName: LEVEL_NAME[escalation.toLevel] ?? `level ${escalation.toLevel}`,
    trigger: escalation.trigger,
    reason: escalation.reason,
    at: escalation.at,
    raisedBy: escalation.raisedBy,
    toUser: escalation.toUser,
    acknowledgedAt: escalation.acknowledgedAt,
    acknowledgedBy: escalation.acknowledgedBy,
    acknowledgeNote: escalation.acknowledgeNote,
    resolvedAt: escalation.resolvedAt,
  }
}

export function layer2Request(request: Layer2Request, referenceDate: Date) {
  return {
    ...layer1Request(request, referenceDate),
    escalationLevel: request.escalationLevel,
    escalationLevelName: LEVEL_NAME[request.escalationLevel] ?? `level ${request.escalationLevel}`,
    escalations: request.escalations.map(escalationView),
  }
}
