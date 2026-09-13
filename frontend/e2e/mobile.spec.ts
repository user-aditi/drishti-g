import { expect, test, type Page } from '@playwright/test'
import { api, fileRequest, issueWorkOrder, pageAs, photoPath, type Role } from './support'

/**
 * The pages people use on a phone, at phone width.
 *
 * The crew page is only ever opened on a phone at the site; filing, the request
 * page and a resident's own register mostly are. At 375 pixels — the narrowest
 * phone still common — none of them may scroll sideways: a page that does hides
 * the half of every line the reader has to find by dragging. Registers are the
 * exception by design, and they scroll inside their own frame, not the page.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })

let srNumber = ''
let code = ''

test.beforeAll(async () => {
    const filed = await fileRequest(await api('citizen'), 'phone width')
    srNumber = filed.srNumber
    code = (await issueWorkOrder(filed.id)).code
})

async function noSidewaysScroll(page: Page, label: string) {
    const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth
        const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((el) => {
                const box = el.getBoundingClientRect()
                // Inside a scrolling frame is fine: that is where wide tables belong.
                const scroller = el.closest('.register-scroll, [class*="overflow-x-auto"], .leaflet-container')
                return box.right > width + 1 && !scroller && getComputedStyle(el).position !== 'fixed'
            })
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}px`)
        return { scrollWidth: document.documentElement.scrollWidth, width, offenders }
    })
    expect(overflow.offenders, `${label} is wider than the phone`).toEqual([])
    expect(overflow.scrollWidth, `${label} scrolls sideways`).toBeLessThanOrEqual(overflow.width + 1)
}

const PAGES: { label: string; role: Role | 'anon'; path: () => string; ready?: (page: Page) => Promise<unknown> }[] = [
    { label: 'the crew page', role: 'anon', path: () => `/w/${code}`, ready: (page) => page.getByText(code).first().waitFor() },
    { label: 'the request page, public', role: 'anon', path: () => `/sr/${srNumber}` },
    { label: 'the request page, as its reporter', role: 'citizen', path: () => `/sr/${srNumber}` },
    { label: 'my requests', role: 'citizen', path: () => '/my/requests' },
    { label: 'notifications', role: 'citizen', path: () => '/notifications' },
    { label: 'account', role: 'citizen', path: () => '/account' },
    { label: 'the landing page', role: 'anon', path: () => '/' },
]

for (const entry of PAGES) {
    test(`${entry.label} fits a phone`, async ({ browser }) => {
        const page = await pageAs(browser, entry.role)
        await page.setViewportSize({ width: 375, height: 812 })
        await page.goto(entry.path())
        await page.waitForLoadState('load')
        if (entry.ready) await entry.ready(page)
        await noSidewaysScroll(page, entry.label)
    })
}

test('every step of filing fits a phone', async ({ browser }) => {
    const page = await pageAs(browser, 'anon')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/file')
    await noSidewaysScroll(page, 'filing: problem')
    await page.getByLabel('Street Condition').check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await noSidewaysScroll(page, 'filing: details')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.fill('#address', 'E2E — phone width — 1 TEST STREET')
    await page.getByText('Enter coordinates instead').click()
    await page.fill('#lat', '40.6501')
    await page.fill('#lon', '-73.9496')
    await page.locator('.leaflet-marker-icon').waitFor()
    await noSidewaysScroll(page, 'filing: location')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.setInputFiles('#request-photos', photoPath(6))
    await noSidewaysScroll(page, 'filing: photographs')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await noSidewaysScroll(page, 'filing: reported by')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await noSidewaysScroll(page, 'filing: confirm')
})

test('a crew whose upload drops on mobile data keeps its photographs and sends again', async ({ browser }) => {
    const filed = await fileRequest(await api('anon'), 'dropped upload')
    const job = await issueWorkOrder(filed.id)

    const crew = await pageAs(browser, 'anon')
    await crew.setViewportSize({ width: 375, height: 812 })
    // The first attempt loses its connection; the second gets through.
    let attempts = 0
    await crew.route(`**/work-orders/${job.code}/complete`, async (route) => {
        attempts++
        if (attempts === 1) await route.abort('internetdisconnected')
        else await route.continue()
    })

    await crew.goto(`/w/${job.code}`)
    await crew.setInputFiles('#crew-photos', photoPath(7))
    await expect(crew.getByText(/1 photograph ready, \d+\.\d MB/)).toBeVisible()
    await crew.fill('#crew-note', 'Filled — end-to-end test, on a bad connection.')
    await crew.getByRole('button', { name: 'The job is done' }).click()

    await expect(crew.getByRole('alert').filter({ hasText: 'Your photographs and note are still here' })).toBeVisible()
    await expect(crew.locator('#crew-note')).toHaveValue('Filled — end-to-end test, on a bad connection.')
    await crew.getByRole('button', { name: 'Send again' }).click()
    await expect(crew.getByText('Recorded. The officer will check it.')).toBeVisible()
    expect(attempts).toBe(2)
})
