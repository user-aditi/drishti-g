/**
 * The audit chain under concurrency, and under deletion.
 *
 * Both properties tested here were broken in shipped code, and neither failed
 * anywhere visible — the chain simply stopped verifying, and the only symptom
 * was a red badge on a screen nobody looks at until they need it. They are
 * pinned here because that is the failure mode this table exists to prevent,
 * and because both bugs are the kind that come back.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import * as audit from '../src/services/audit.js'
import { prisma, reset } from './fixture.js'

beforeEach(async () => {
  await reset()
})

async function citizen(email: string) {
  return prisma.user.create({
    data: {
      email,
      fullName: 'Audit Test Person',
      hashedPassword: 'test-not-a-real-hash',
      role: 'CITIZEN',
      rank: 'CITIZEN',
    },
  })
}

describe('appending concurrently', () => {
  /**
   * The regression that mattered.
   *
   * `record()` reads the newest row for its `prevHash` and then inserts. Without
   * a lock, overlapping writers both read the same head and both claim it, so
   * the chain forks — on a simulated run of 1,600 complaints, 410 hashes were
   * claimed by more than one row. Nothing threw; the chain just stopped being
   * a chain.
   *
   * Twenty parallel appends is enough to reproduce it reliably and fast.
   */
  it('produces one unbroken chain when twenty writers append at once', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        audit.record(prisma, {
          action: 'test.concurrent',
          entityType: 'test',
          entityId: i,
          payload: { i },
        }),
      ),
    )

    const result = await audit.verifyChain(prisma)
    expect(result.reason).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.checked).toBe(20)
  })

  it('never lets two entries claim the same predecessor', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        audit.record(prisma, {
          action: 'test.concurrent',
          entityType: 'test',
          entityId: i,
          payload: { i },
        }),
      ),
    )

    const events = await prisma.auditEvent.findMany({ select: { prevHash: true } })
    const claimed = events.map((e) => e.prevHash)
    expect(new Set(claimed).size).toBe(claimed.length)
  })
})

describe('the chain survives the rest of the schema', () => {
  /**
   * `AuditEvent.actorId` is one of the seven fields the hash covers. It used to
   * be `onDelete: SetNull`, so deleting a user rewrote the hashed content of
   * every entry they ever produced and every one of them stopped verifying —
   * reported, correctly, as having been edited after the fact. 273 entries were
   * lost that way in development.
   *
   * Nothing in the product deletes a user; staff are deactivated. So the right
   * behaviour is to refuse rather than to quietly rewrite history.
   */
  it('refuses to delete a user who has written to it', async () => {
    const user = await citizen('audited@test.local')
    await audit.record(prisma, {
      action: 'test.by_user',
      entityType: 'test',
      entityId: 1,
      payload: {},
      actorId: user.id,
      actorLabel: user.fullName,
    })

    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow()

    // And the entry is still exactly as it was written.
    expect((await audit.verifyChain(prisma)).valid).toBe(true)
  })

  it('still verifies after a user is deactivated, which is what the product does', async () => {
    const user = await citizen('deactivated@test.local')
    await audit.record(prisma, {
      action: 'test.by_user',
      entityType: 'test',
      entityId: 1,
      payload: {},
      actorId: user.id,
      actorLabel: user.fullName,
    })

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
    expect((await audit.verifyChain(prisma)).valid).toBe(true)
  })
})

describe('detecting tampering', () => {
  it('notices an edited payload', async () => {
    await audit.record(prisma, {
      action: 'test.one',
      entityType: 'test',
      entityId: 1,
      payload: { amount: 100 },
    })
    const second = await audit.record(prisma, {
      action: 'test.two',
      entityType: 'test',
      entityId: 2,
      payload: { amount: 200 },
    })

    await prisma.auditEvent.update({
      where: { id: second.id },
      data: { payload: { amount: 999 } },
    })

    const result = await audit.verifyChain(prisma)
    expect(result.valid).toBe(false)
    expect(result.brokenAtId).toBe(second.id)
  })

  /**
   * The timestamp is deliberately outside the hash, and the traffic simulator
   * depends on that: it rewrites timestamps after the API has written the rows,
   * and the chain has to survive it. If this ever starts failing, the simulator
   * is producing data with a broken audit trail.
   */
  it('does not mind a rewritten timestamp', async () => {
    const event = await audit.record(prisma, {
      action: 'test.one',
      entityType: 'test',
      entityId: 1,
      payload: {},
    })

    await prisma.auditEvent.update({
      where: { id: event.id },
      data: { createdAt: new Date('2020-01-01T00:00:00Z') },
    })

    expect((await audit.verifyChain(prisma)).valid).toBe(true)
  })
})
