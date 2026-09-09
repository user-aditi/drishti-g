/**
 * What may lawfully happen to this complaint next, and who may do it.
 *
 * Mostly this exposes a decision the system already made. `ALLOWED_TRANSITIONS`
 * in gcce.ts is a hand-authored normative process model — the very thing the
 * process-mining literature usually has to *mine* from an event log and then
 * worry about circularity, because a model learned from the same traces you
 * evaluate on cannot tell you whether those traces were correct. This one was
 * written from how the authority actually works, before any log existed. That
 * is a real methodological advantage and the second paper should say so
 * plainly.
 *
 * What this module adds is the other half of "permitted". A transition being
 * legal in the abstract does not mean *this person* may perform it *now*: a
 * Section Officer cannot close a complaint that has climbed to zone level, and
 * nobody can dispatch a crew from a post nobody holds. Feasibility is the
 * intersection of four things —
 *
 *   1. the state machine        — which statuses may follow this one
 *   2. the actor's rank         — closing is a Circle Officer's privilege
 *   3. the actor's posting      — their subtree, and their department
 *   4. the world                — a work order needs somewhere to send it
 *
 * — and the intersection is what the autonomy gate renormalises confidence over
 * in wave 4. That is the entire idea of the second paper: a model's top
 * prediction is worth nothing if policy forbids it, so the probability that
 * matters is the one computed over the actions actually available.
 *
 * Blocked actions are returned, not hidden. An officer who cannot see that
 * closing exists learns nothing; one who sees "Close — needs a Circle Officer"
 * learns how the authority works. It also means the gate can explain a refusal
 * in the same words the officer would read.
 */
import { ComplaintStatus, Rank } from '@prisma/client'
import type { Db } from './audit.js'
import { ALLOWED_TRANSITIONS } from './gcce.js'
import { RANK_LEVEL, hasJurisdiction } from './hierarchy.js'

/** One thing that could happen next, whether or not it may. */
export interface FeasibleAction {
  /** The status this would move the complaint into. */
  action: ComplaintStatus
  /** True when this actor may perform it right now. */
  permitted: boolean
  /**
   * The rule that allows it, in the officer's own vocabulary. Present whether
   * or not it is permitted, because the reason it *would* be allowed is part of
   * explaining why it is not.
   */
  permittedBy: string
  /** Why not, where it is not. Null when permitted. */
  blockedReason: string | null
}

/** The minimum a complaint must expose for feasibility to be decidable. */
export interface FeasibilityTarget {
  id: number
  status: ComplaintStatus
  departmentId: number | null
  sectorId: number | null
  orgUnitId: number | null
  assignedOfficerId: number | null
}

export interface Actor {
  id: number
  rank: Rank
}

/**
 * The rank each transition requires.
 *
 * Closing sits above resolving on purpose: the officer who did the work must
 * not be the one who signs it off, which is the oldest control in public
 * administration and the reason this is a table rather than a single guard.
 */
const RANK_REQUIRED: Partial<Record<ComplaintStatus, Rank>> = {
  [ComplaintStatus.CLOSED]: Rank.CIRCLE_OFFICER,
  [ComplaintStatus.REJECTED]: Rank.CIRCLE_OFFICER,
  [ComplaintStatus.DUPLICATE]: Rank.SECTION_OFFICER,
  [ComplaintStatus.IN_PROGRESS]: Rank.SECTION_OFFICER,
  [ComplaintStatus.AWAITING_VERIFICATION]: Rank.SECTION_OFFICER,
  [ComplaintStatus.RESOLVED]: Rank.SECTION_OFFICER,
  [ComplaintStatus.ASSIGNED]: Rank.SECTION_OFFICER,
}

/** How each transition reads to a person, for the explanation. */
const ACTION_LABEL: Record<ComplaintStatus, string> = {
  [ComplaintStatus.SUBMITTED]: 'Return to filed',
  [ComplaintStatus.ROUTED]: 'Route',
  [ComplaintStatus.ASSIGNED]: 'Assign to an officer',
  [ComplaintStatus.IN_PROGRESS]: 'Send a crew',
  [ComplaintStatus.AWAITING_VERIFICATION]: 'Report work done',
  [ComplaintStatus.RESOLVED]: 'Accept the work',
  [ComplaintStatus.CLOSED]: 'Close',
  [ComplaintStatus.REJECTED]: 'Reject',
  [ComplaintStatus.DUPLICATE]: 'Mark duplicate',
}

/** Statuses from which nothing further may happen. */
export function isTerminal(status: ComplaintStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0
}

/**
 * Every action the state machine allows from here, each marked with whether
 * this actor may take it and why not.
 *
 * Called without an actor, it answers the policy question alone — which is what
 * the autonomy gate needs, since the gate acts on nobody's behalf.
 */
export async function feasibleActions(
  db: Db,
  complaint: FeasibilityTarget,
  actor?: Actor,
): Promise<FeasibleAction[]> {
  const candidates = ALLOWED_TRANSITIONS[complaint.status]
  if (candidates.length === 0) return []

  // One jurisdiction check for the whole complaint rather than one per action:
  // scope is a property of where the complaint sits, not of what is being done
  // to it, and the check walks the org tree.
  const inScope = actor
    ? await hasJurisdiction(db, actor, {
        departmentId: complaint.departmentId,
        sectorId: complaint.sectorId,
        orgUnitId: complaint.orgUnitId,
      })
    : true

  const results: FeasibleAction[] = []

  for (const action of candidates) {
    const required = RANK_REQUIRED[action]
    const permittedBy = required
      ? `${ACTION_LABEL[action]} — allowed from ${label(complaint.status)} for ${RANK_LABEL_SHORT[required]} and above`
      : `${ACTION_LABEL[action]} — allowed from ${label(complaint.status)}`

    let blockedReason: string | null = null

    if (actor) {
      if (required && RANK_LEVEL[actor.rank] < RANK_LEVEL[required]) {
        blockedReason = `Needs ${RANK_LABEL_SHORT[required]} or above; you are ${RANK_LABEL_SHORT[actor.rank]}.`
      } else if (!inScope) {
        blockedReason = 'This complaint is outside the ground you cover.'
      } else if (
        action === ComplaintStatus.IN_PROGRESS &&
        complaint.assignedOfficerId == null
      ) {
        // A crew is dispatched by whoever holds the complaint. With the post
        // vacant there is nobody to issue the code, and the work order would
        // have no issuer to record.
        blockedReason = 'Nobody holds this complaint yet, so no crew can be sent.'
      }
    }

    results.push({
      action,
      permitted: blockedReason == null,
      permittedBy,
      blockedReason,
    })
  }

  return results
}

/** Just the actions this actor may actually take — what the gate consumes. */
export async function permittedActions(
  db: Db,
  complaint: FeasibilityTarget,
  actor?: Actor,
): Promise<ComplaintStatus[]> {
  const actions = await feasibleActions(db, complaint, actor)
  return actions.filter((a) => a.permitted).map((a) => a.action)
}

const RANK_LABEL_SHORT: Record<Rank, string> = {
  [Rank.CITIZEN]: 'a citizen',
  [Rank.FIELD_WORKER]: 'a field worker',
  [Rank.SECTION_OFFICER]: 'a Section Officer',
  [Rank.CIRCLE_OFFICER]: 'a Circle Officer',
  [Rank.ZONAL_OFFICER]: 'a Zonal Officer',
  [Rank.HOD]: 'a General Manager',
  [Rank.CEO]: 'the CEO',
  [Rank.SUPER_ADMIN]: 'the Super Admin',
}

function label(status: ComplaintStatus): string {
  return status.toLowerCase().replace(/_/g, ' ')
}
