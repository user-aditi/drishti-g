/**
 * Each record judged at the moment it was observed.
 *
 * NYC's rows were observed once, at the snapshot, and are judged there. A
 * request filed through this system is live and is judged against the real
 * clock. Before this rule, a filing here — its deadline days after the snapshot —
 * could never be overdue (F-24), and Layer 2's sweep could never fire.
 *
 * The test config pins the reference date to 2025-12-31. Both rows below are due
 * yesterday in real time, which is after that date: by the snapshot neither is
 * late, by the real clock both are. Only the live one may be reported overdue.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Channel, RequestStatus, Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
const DAY = 86_400_000
let f: Fixture

async function row(srNumber: string, isImported: boolean) {
  return prisma.serviceRequest.create({
    data: {
      srNumber,
      typeId: f.streetType,
      agencyId: f.dot,
      orgUnitId: f.board1,
      status: RequestStatus.OPEN,
      channel: Channel.ONLINE,
      createdAt: new Date(Date.now() - 10 * DAY),
      slaDueAt: new Date(Date.now() - DAY),
      isImported,
    },
  })
}

beforeEach(async () => {
  await reset()
  f = await build()
  await row('DG-2026-900001', false)
  await row('NYC-900002', true)
})

describe('the per-record clock', () => {
  it('judges this system’s own filing against the real clock', async () => {
    const res = await request(app).get(`${api}/requests/DG-2026-900001`).expect(200)
    expect(res.body.isOverdue).toBe(true)
  })

  it('judges an imported row at the snapshot, where it is not yet due', async () => {
    const res = await request(app).get(`${api}/requests/NYC-900002`).expect(200)
    expect(res.body.isOverdue).toBe(false)
  })

  it('applies the same rule in the queue’s overdue filter', async () => {
    const res = await request(app)
      .get(`${api}/requests?overdue=true`)
      .set('Authorization', `Bearer ${signToken(f.dotAgent, 'access', Role.AGENT)}`)
      .expect(200)
    expect(res.body.rows.map((r: { srNumber: string }) => r.srNumber)).toEqual(['DG-2026-900001'])
  })

  it('applies it in the board register', async () => {
    const res = await request(app).get(`${api}/boards`).expect(200)
    const board = res.body.find((b: { code: string }) => b.code === 'BK-01')
    expect(board.open).toBe(2)
    expect(board.overdue).toBe(1)
  })
})
