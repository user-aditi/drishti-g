import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { api, fileRequest, ids, pageAs, photoPath } from './support'

/**
 * A point in Brooklyn no earlier run used: repeated runs leave open requests
 * behind, and the nearby hint lists only the five closest.
 */
function freshPoint() {
    const jitter = () => Math.round(Math.random() * 20_000) / 1e6
    return { lat: Number((40.61 + jitter()).toFixed(6)), lon: Number((-73.93 + jitter()).toFixed(6)) }
}

/**
 * Phase 12 — the resident's side, through the screens.
 *
 * Filing with a pin and a photograph; progress on the public page; being told
 * when the request closes; the hint that something is already reported; an agent
 * finding a request when the resident calls back; and changing a password.
 */

test('a resident files with a pin and a photograph, follows its progress, and is told when it closes', async ({
    browser,
}) => {
    const resident = await pageAs(browser, 'citizen')
    await resident.goto('/file')
    await resident.getByLabel('Street Condition').check()
    await resident.getByRole('button', { name: 'Continue', exact: true }).click()
    await resident.getByRole('button', { name: 'Continue', exact: true }).click()

    await resident.fill('#address', 'E2E — pin and photograph — 1 TEST STREET')
    await resident.selectOption('#board', String(ids().bk04BoardId))
    const point = freshPoint()
    await resident.getByText('Enter coordinates instead').click()
    await resident.fill('#lat', String(point.lat))
    await resident.fill('#lon', String(point.lon))
    await expect(resident.getByText(`Pin at ${point.lat}, ${point.lon}`)).toBeVisible()
    await expect(resident.locator('.leaflet-marker-icon')).toHaveCount(1)
    await resident.getByRole('button', { name: 'Continue', exact: true }).click()

    await resident.setInputFiles('#request-photos', photoPath(5))
    await expect(resident.getByRole('img', { name: /^Preview of / })).toBeVisible()
    await resident.getByRole('button', { name: 'Continue', exact: true }).click()
    await resident.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(resident.getByText('1 attached')).toBeVisible()
    await resident.getByRole('button', { name: 'File this request' }).click()

    await expect(resident.getByText('Your photograph is attached.')).toBeVisible()
    const srNumber = (await resident.getByText(/DG-\d{4}-\d{6}/).first().textContent())!.match(/DG-\d{4}-\d{6}/)![0]

    // The reporter sees their photograph and the progress.
    await resident.goto(`/sr/${srNumber}`)
    await expect(resident.getByText('An officer is answering for it')).toBeVisible()
    await expect(resident.getByRole('img', { name: `Photograph 1 attached when ${srNumber} was reported` })).toBeVisible()

    // The public sees that a photograph exists, not the photograph.
    const visitor = await pageAs(browser, 'anon')
    await visitor.goto(`/sr/${srNumber}`)
    await expect(visitor.getByText(/A photograph was attached when this was reported/)).toBeVisible()
    await expect(visitor.getByRole('img', { name: /attached when/ })).toHaveCount(0)

    // The agency closes it; the resident is told.
    const agent = await api('agent')
    const found = await agent.get(`requests/${srNumber}`)
    const { id } = (await found.json()) as { id: number }
    const closed = await agent.patch(`requests/${id}/status`, {
        data: { status: 'CLOSED', note: 'Resurfaced — end-to-end test.' },
    })
    expect(closed.ok()).toBeTruthy()

    await resident.goto('/notifications')
    const notice = resident.getByRole('link', { name: new RegExp(`${srNumber} is now closed`) })
    await expect(notice).toBeVisible()
    await notice.click()
    await expect(resident).toHaveURL(new RegExp(`/sr/${srNumber}$`))
    await expect(resident.getByText('Closed', { exact: true }).last()).toBeVisible()
})

test('filing warns that the same problem is already reported nearby', async ({ browser }) => {
    const point = freshPoint()
    const existing = await fileRequest(await api('anon'), 'already reported', { latitude: point.lat, longitude: point.lon })

    const page = await pageAs(browser, 'anon')
    await page.goto('/file')
    await page.getByLabel('Street Condition').check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByText('Enter coordinates instead').click()
    await page.fill('#lat', String(point.lat + 0.00001))
    await page.fill('#lon', String(point.lon))

    await expect(page.getByText(/may already be reported|open reports like this are nearby/)).toBeVisible()
    await expect(page.getByRole('link', { name: existing.srNumber })).toBeVisible()
})

test('an agent finds a request by searching the queue', async ({ browser }) => {
    const marker = `SEARCH${randomBytes(3).toString('hex').toUpperCase()}`
    const filed = await fileRequest(await api('anon'), marker)

    const agent = await pageAs(browser, 'agent')
    await agent.goto('/agency/queue')
    await agent.getByRole('searchbox', { name: 'Search' }).fill(marker.toLowerCase())
    await agent.keyboard.press('Enter')
    await expect(agent).toHaveURL(new RegExp(`q=${marker.toLowerCase()}`))
    await expect(agent.getByRole('link', { name: filed.srNumber })).toBeVisible()
})

test('a resident updates their details and changes their password', async ({ browser }) => {
    const page = await pageAs(browser, 'account')
    await page.goto('/account')
    await page.fill('#profile-name', 'E2E Account Resident Renamed')
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    // A throwaway password for a throwaway account, reset by the setup every run.
    const next = randomBytes(12).toString('base64url')
    await page.fill('#password-current', ids().accountPassword)
    await page.fill('#password-new', next)
    await page.fill('#password-confirm', next)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText('Your password has been changed.')).toBeVisible()

    // This session was reissued, so it is still signed in.
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
})
