/**
 * A signed-in resident's filing is theirs.
 *
 * The filing route ran no authentication, so every request filed through the app
 * was anonymous — a resident never saw their own requests, and Layer 4's question
 * could never reach them. The end-to-end tests found it; these keep it found.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Role } from '@prisma/client'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { signToken } from '../src/lib/auth.js'
import { build, prisma, reset, type Fixture } from './fixture.js'

const app = createApp()
const api = env.API_PREFIX
let f: Fixture

beforeEach(async () => {
  await reset()
  f = await build()
})

describe('who a filing belongs to', () => {
  it('attributes a filing to the signed-in resident, who then sees it as theirs', async () => {
    const res = await request(app)
      .post(`${api}/requests`)
      .set('Authorization', `Bearer ${signToken(f.citizen, 'access', Role.CITIZEN)}`)
      .send({ typeId: f.streetType })
      .expect(201)

    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { srNumber: res.body.srNumber } })
    expect(stored.citizenId).toBe(f.citizen)

    const mine = await request(app)
      .get(`${api}/requests/mine/list`)
      .set('Authorization', `Bearer ${signToken(f.citizen, 'access', Role.CITIZEN)}`)
      .expect(200)
    expect(mine.body.rows.map((row: { srNumber: string }) => row.srNumber)).toContain(res.body.srNumber)
  })

  it('files anonymously with no session, and with a broken one rather than refusing the report', async () => {
    const none = await request(app).post(`${api}/requests`).send({ typeId: f.streetType }).expect(201)
    const broken = await request(app)
      .post(`${api}/requests`)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ typeId: f.streetType })
      .expect(201)

    for (const srNumber of [none.body.srNumber, broken.body.srNumber]) {
      expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { srNumber } })).citizenId).toBeNull()
    }
  })
})
