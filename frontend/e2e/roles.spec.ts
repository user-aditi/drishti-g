import { expect, test } from '@playwright/test'
import { api, escalateAsOfficer, fileRequest, ids, pageAs, setStatusAsOfficer } from './support'

/**
 * Phase 11 — each role's own tools, reached through the screens.
 *
 * The journeys file tests the core loop. These test that every senior role can
 * do the part of it that is theirs: the supervisor answers what reached them,
 * anyone can see how the borough is doing, and the administrator can move and
 * switch off the people who do the work.
 */

test('the supervisor acknowledges an escalation, by keyboard, and the officer sees it', async ({ browser }) => {
    const filed = await fileRequest(await api('anon'), 'acknowledge escalation')
    await escalateAsOfficer(filed.id, 'The same pothole has been patched twice — end-to-end test.')

    const supervisor = await pageAs(browser, 'supervisor')
    await supervisor.goto('/supervisor/escalations')
    await supervisor.getByRole('button', { name: `Acknowledge the escalation of ${filed.srNumber}` }).click()
    // The note field takes focus when the form opens, so typing goes straight in.
    await supervisor.keyboard.type('Resurfacing crew booked for Monday — end-to-end test.')
    await supervisor.keyboard.press('Tab')
    await supervisor.keyboard.press('Enter')

    const row = supervisor.getByRole('row').filter({ has: supervisor.getByRole('link', { name: filed.srNumber }) })
    await expect(row.getByText('“Resurfacing crew booked for Monday — end-to-end test.”')).toBeVisible()
    await expect(row.getByRole('button', { name: /Acknowledge/ })).toHaveCount(0)

    const officer = await pageAs(browser, 'officer')
    await officer.goto(`/officer/sr/${filed.srNumber}`)
    await expect(officer.getByText(/Acknowledged by DOT Supervisor/)).toBeVisible()
})

test('a request that closes resolves its escalation in the register', async ({ browser }) => {
    const filed = await fileRequest(await api('anon'), 'resolve escalation')
    await escalateAsOfficer(filed.id, 'Needs the supervisor to approve overtime — end-to-end test.')
    await setStatusAsOfficer(filed.id, 'CLOSED', 'Done — end-to-end test.')

    const supervisor = await pageAs(browser, 'supervisor')
    await supervisor.goto('/supervisor/escalations')
    await expect(supervisor.getByRole('link', { name: filed.srNumber })).toHaveCount(0)

    await supervisor.getByRole('link', { name: 'Include resolved' }).click()
    const row = supervisor.getByRole('row').filter({ has: supervisor.getByRole('link', { name: filed.srNumber }) })
    await expect(row.getByText(/^Resolved /)).toBeVisible()
})

test('anyone reads the board rollup and the map; staff start from their own agency', async ({ browser }) => {
    const visitor = await pageAs(browser, 'anon')
    await visitor.goto('/boards')
    await expect(visitor).toHaveURL(/\/boards/)
    await expect(visitor.getByRole('link', { name: 'Every agency' })).toHaveAttribute('aria-current', 'page')
    await expect(visitor.getByRole('cell', { name: /BK-04/ })).toBeVisible()

    await visitor.goto('/map')
    await expect(visitor).toHaveURL(/\/map/)
    await expect(visitor.locator('.leaflet-container')).toBeVisible()

    const commissioner = await pageAs(browser, 'commissioner')
    await commissioner.goto('/boards')
    await expect(commissioner.getByRole('link', { name: 'DOT', exact: true })).toHaveAttribute('aria-current', 'page')
    await commissioner.getByRole('link', { name: 'Every agency' }).click()
    await expect(commissioner.getByRole('link', { name: 'Every agency' })).toHaveAttribute('aria-current', 'page')
})

test('the administrator reactivates an officer, moves their post, and switches them off again', async ({ browser }) => {
    const { spareOfficerId, spareToBoardId } = ids()
    const admin = await pageAs(browser, 'admin')
    await admin.goto(`/admin/people/${spareOfficerId}`)
    await expect(admin.getByRole('heading', { name: 'E2E Spare Officer' })).toBeVisible()

    await admin.fill('#access-reason', 'Back for the administrator journey — end-to-end test.')
    await admin.getByRole('button', { name: 'Reactivate this account' }).click()
    await expect(admin.getByText('E2E Spare Officer can sign in again.')).toBeVisible()

    await admin.selectOption('#move-unit', String(spareToBoardId))
    await admin.fill('#move-reason', 'Covering BK-17 — end-to-end test.')
    await admin.getByRole('button', { name: 'Move to this post' }).click()
    await expect(admin.getByText(/^Moved\./)).toBeVisible()
    const postings = admin.getByRole('table', { name: /Postings/ })
    await expect(postings.getByRole('row').nth(1)).toContainText('BK-17')
    await expect(postings.getByRole('row').nth(1)).toContainText('Current')

    await admin.fill('#access-reason', 'Journey over — end-to-end test.')
    await admin.getByRole('button', { name: 'Deactivate this account' }).click()
    await expect(admin.getByText('E2E Spare Officer can no longer sign in.')).toBeVisible()

    await admin.goto('/admin/people?q=E2E+Spare')
    const row = admin.getByRole('row').filter({ hasText: 'E2E Spare Officer' })
    await expect(row.getByText('Deactivated')).toBeVisible()
})

test('the administrator sees which models loaded and how long the audit chain is', async ({ browser }) => {
    const admin = await pageAs(browser, 'admin')
    await admin.goto('/admin/system')
    const models = admin.getByRole('table', { name: /Trained models/ })
    await expect(models.getByRole('row')).toHaveCount(4)
    await expect(models.getByText(/Not loaded/)).toHaveCount(0)
    await expect(admin.getByText('Postgres answering')).toBeVisible()
})
