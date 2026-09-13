import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, request, type APIRequestContext, type Browser, type Page } from '@playwright/test'

/** Where the API is. The journeys use it to set up data they then act on in a browser. */
export const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'

export type Role = 'citizen' | 'agent' | 'officer' | 'supervisor' | 'commissioner' | 'admin'
    /** A resident kept for the account journey, whose password the tests change. */
    | 'account'

/** A role's signed session, written by the global setup. */
export const stateFor = (role: Role) => path.join(__dirname, '.auth', `${role}.json`)

/** A photograph generated for this run, so the recycled check never sees it twice. */
export const photoPath = (n: number) => path.join(__dirname, '.tmp', `photo-${n}.jpg`)

export function ids(): {
    streetConditionTypeId: number
    bk04BoardId: number
    dotAgencyId: number
    /** An officer kept for the administrator's journey: deactivated, posted to BK-18, holding no work. */
    spareOfficerId: number
    spareFromBoardId: number
    spareToBoardId: number
    accountPassword: string
} {
    return JSON.parse(readFileSync(path.join(__dirname, '.tmp', 'ids.json'), 'utf8'))
}

/** An API client acting as a role, or as nobody. */
export function api(role: Role | 'anon'): Promise<APIRequestContext> {
    return request.newContext({
        baseURL: `${API}/`,
        ...(role === 'anon' ? {} : { storageState: stateFor(role) }),
    })
}

/** A browser page signed in as a role, or signed out. */
export async function pageAs(browser: Browser, role: Role | 'anon'): Promise<Page> {
    const context = await browser.newContext(role === 'anon' ? {} : { storageState: stateFor(role) })
    return context.newPage()
}

/**
 * File a Street Condition request on BK-04 through the API.
 *
 * BK-04's posting rule assigns it to that board's officer, which is the officer
 * whose session the journeys use. The address says E2E so the row can never be
 * mistaken for NYC's record or a real report.
 */
export async function fileRequest(
    client: APIRequestContext,
    label: string,
    extra: { latitude?: number; longitude?: number } = {},
) {
    const { streetConditionTypeId, bk04BoardId } = ids()
    const response = await client.post('requests', {
        data: {
            typeId: streetConditionTypeId,
            orgUnitId: bk04BoardId,
            address: `E2E — ${label} — 1 TEST STREET`,
            channel: 'ONLINE',
            ...extra,
        },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    return (await response.json()) as { id: number; srNumber: string }
}

/** Send a crew out: the officer issues a work order on a request they answer for. */
export async function issueWorkOrder(requestId: number) {
    const officer = await api('officer')
    const response = await officer.post('work-orders', { data: { requestId } })
    expect(response.ok(), await response.text()).toBeTruthy()
    return (await response.json()) as { code: string }
}

/** The crew reports the job done with a photograph, as the crew page would. */
export async function reportDone(code: string, photo: number, note: string) {
    const crew = await api('anon')
    const response = await crew.post(`work-orders/${code}/complete`, {
        multipart: {
            note,
            photos: { name: 'done.jpg', mimeType: 'image/jpeg', buffer: readFileSync(photoPath(photo)) },
        },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    return (await response.json()) as { ok: boolean; proof: { outcome: string } }
}

/** The officer escalates a request they answer for, with a reason. */
export async function escalateAsOfficer(requestId: number, reason: string) {
    const officer = await api('officer')
    const response = await officer.post(`requests/${requestId}/escalate`, { data: { reason } })
    expect(response.ok(), await response.text()).toBeTruthy()
}

/** The officer changes a request's status through their own route. */
export async function setStatusAsOfficer(requestId: number, status: string, note?: string) {
    const officer = await api('officer')
    const response = await officer.patch(`officer/requests/${requestId}/status`, {
        data: { status, ...(note ? { note } : {}) },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
}
