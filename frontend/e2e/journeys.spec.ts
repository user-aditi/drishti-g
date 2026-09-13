import { expect, test } from '@playwright/test'
import { api, fileRequest, ids, issueWorkOrder, pageAs, photoPath, reportDone } from './support'

/**
 * The product's core journeys, end to end, each across the people it involves.
 *
 * The backend suite proves each rule. What only a browser proves is that the
 * rules are reachable: that a person can actually get from the start of a
 * process to its end through the screens. Phase 9 exists because one of these
 * could not — the officer could accept a crew's work and had no way to close
 * the request — and no test caught it, because every test began or ended at an
 * API call.
 */

test('a member of the public files a request and looks it up by its number', async ({ page }) => {
    await page.goto('/file')
    await page.getByLabel('Street Condition').check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await page.fill('#address', 'E2E — public filing — 1 TEST STREET')
    await page.selectOption('#board', String(ids().bk04BoardId))
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    // Photographs are optional.
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'File this request' }).click()

    await expect(page.getByText('Request filed')).toBeVisible()
    const srNumber = (await page.getByText(/DG-\d{4}-\d{6}/).first().textContent())!.match(/DG-\d{4}-\d{6}/)![0]

    await page.getByRole('link', { name: 'View its status' }).click()
    await expect(page).toHaveURL(new RegExp(`/sr/${srNumber}$`))
    await expect(page.getByText(srNumber).first()).toBeVisible()
})

test('an agent closes a request with a resolution note', async ({ browser }) => {
    const filed = await fileRequest(await api('anon'), 'agent closes')
    const page = await pageAs(browser, 'agent')

    await page.goto(`/agency/sr/${filed.srNumber}`)
    await page.selectOption('#status', 'CLOSED')
    await page.fill('#note', 'Closed by the agency in an end-to-end test.')
    await page.getByRole('button', { name: 'Change status' }).click()

    await expect(page.getByText('Already closed.')).toBeVisible()
})

test('the officer’s loop: send a crew, check its photograph, accept it, close the request', async ({ browser }) => {
    const filed = await fileRequest(await api('anon'), 'officer loop')
    const { code } = await issueWorkOrder(filed.id)

    // The crew, with no account, reports the job done through the code page.
    const crew = await pageAs(browser, 'anon')
    await crew.goto(`/w/${code}`)
    await crew.setInputFiles('#crew-photos', photoPath(1))
    await crew.fill('#crew-note', 'Patched and rolled — end-to-end test.')
    await crew.getByRole('button', { name: 'The job is done' }).click()
    // Filed anonymously, so there is no resident to ask: it goes to the officer.
    await expect(crew.getByText('Recorded. The officer will check it.')).toBeVisible()

    // The officer finds it in Work to check and accepts it.
    const officer = await pageAs(browser, 'officer')
    await officer.goto('/officer/verify')
    const panel = officer
        .locator('div')
        .filter({ has: officer.getByRole('link', { name: filed.srNumber }) })
        .filter({ has: officer.getByRole('button', { name: 'Accept the work' }) })
        .last()
    await panel.getByRole('button', { name: 'Accept the work' }).click()
    await expect(officer.getByRole('link', { name: filed.srNumber })).toHaveCount(0)

    // And closes the request, with the crew's own note as the resolution.
    await officer.goto(`/officer/sr/${filed.srNumber}`)
    await officer.getByRole('button', { name: /Use the crew’s note/ }).click()
    await officer.getByRole('button', { name: 'Close this request' }).click()
    await expect(officer.getByText('Already closed.')).toBeVisible()
})

test('an officer escalates a request by hand and the supervisor sees it', async ({ browser }) => {
    const filed = await fileRequest(await api('anon'), 'manual escalation')

    const officer = await pageAs(browser, 'officer')
    await officer.goto(`/officer/sr/${filed.srNumber}`)
    await officer.getByRole('button', { name: 'Escalate to the supervisor' }).click()
    await officer.fill('#escalate-reason', 'Needs a resurfacing crew, not another patch — end-to-end test.')
    await officer.getByRole('button', { name: 'Escalate to the supervisor' }).click()
    await expect(officer.getByText('Escalated · supervisor')).toBeVisible()

    const supervisor = await pageAs(browser, 'supervisor')
    await supervisor.goto('/supervisor/escalations')
    await expect(supervisor.getByRole('link', { name: filed.srNumber })).toBeVisible()
})

test('the resident who reported it confirms the crew’s work', async ({ browser }) => {
    const filed = await fileRequest(await api('citizen'), 'resident confirms')
    const { code } = await issueWorkOrder(filed.id)
    const submitted = await reportDone(code, 2, 'Resurfaced — end-to-end test.')
    expect(submitted.proof.outcome).toBe('NEEDS_CITIZEN')

    const resident = await pageAs(browser, 'citizen')
    await resident.goto('/my/requests')
    // The request appears twice here, rightly: in what is waiting on the resident,
    // and in their register below it. The journey is about the first.
    const waiting = resident
        .locator('div')
        .filter({ hasText: 'Waiting on you' })
        .filter({ has: resident.getByRole('link', { name: filed.srNumber }) })
        .last()
    await expect(waiting.getByRole('link', { name: filed.srNumber })).toBeVisible()

    await waiting.getByRole('link', { name: filed.srNumber }).click()
    await expect(resident.getByText('Has this been done?')).toBeVisible()
    await resident.getByRole('button', { name: 'Yes, it has been done' }).click()
    // Answered, the question is no longer put.
    await expect(resident.getByText('Has this been done?')).toHaveCount(0)
})

test('a signed-out visitor is turned away from a staff page', async ({ page }) => {
    await page.goto('/officer/desk')
    await expect(page).toHaveURL(/\/login/)
})
