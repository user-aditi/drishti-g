import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { api, fileRequest, ids, issueWorkOrder, pageAs, type Role } from './support'

/**
 * Every page, audited for accessibility as the person it is for.
 *
 * The design system has claimed WCAG AA since the first revision of the plan,
 * and nothing had ever checked it. A government service that fails this fails
 * its purpose, so the pass is a test rather than an intention: any serious or
 * critical violation on any page fails the build.
 *
 * Moderate and minor findings are reported, not failed on. They are worth
 * reading; failing CI on them would teach people to stop reading the output.
 */

let srNumber = ''
let code = ''

test.beforeAll(async () => {
    const filed = await fileRequest(await api('anon'), 'accessibility pass')
    srNumber = filed.srNumber
    code = (await issueWorkOrder(filed.id)).code
})

const PAGES: { path: () => string; role: Role | 'anon'; label?: string }[] = [
    { path: () => '/', role: 'anon' },
    { path: () => '/file', role: 'anon' },
    { path: () => '/login', role: 'anon' },
    { path: () => '/register', role: 'anon' },
    { path: () => `/sr/${srNumber}`, role: 'anon' },
    { path: () => '/w', role: 'anon' },
    { path: () => `/w/${code}`, role: 'anon' },
    { path: () => '/my/requests', role: 'citizen' },
    { path: () => '/notifications', role: 'citizen' },
    { path: () => '/account', role: 'citizen' },
    { path: () => '/agency/queue', role: 'agent' },
    { path: () => `/agency/sr/${srNumber}`, role: 'agent' },
    { path: () => '/boards', role: 'agent' },
    { path: () => '/map', role: 'agent' },
    { path: () => '/boards', role: 'anon' },
    { path: () => '/map', role: 'anon' },
    { path: () => '/officer/desk', role: 'officer' },
    { path: () => `/officer/sr/${srNumber}`, role: 'officer' },
    { path: () => '/officer/verify', role: 'officer' },
    { path: () => '/supervisor/assign', role: 'supervisor' },
    { path: () => '/supervisor/escalations', role: 'supervisor' },
    { path: () => '/admin/risk', role: 'admin' },
    { path: () => '/admin/routing', role: 'admin' },
    { path: () => '/admin/audit', role: 'admin' },
    { path: () => '/admin/people', role: 'admin' },
    { path: () => `/admin/people/${ids().spareOfficerId}`, role: 'admin', label: '/admin/people/[id]' },
    { path: () => '/admin/system', role: 'admin' },
    { path: () => '/supervisor/escalations', role: 'commissioner' },
]

for (const entry of PAGES) {
    // Labels are made when the file is collected, before the setup has written ids.
    const label = entry.label ?? entry.path().replace(/\/(DG|NYC)-[\w-]+|\/[A-Z0-9]{4}-[A-Z0-9]{4}$/, '/[id]')
    test(`${label} as ${entry.role}: no serious accessibility violations`, async ({ browser }) => {
        const page = await pageAs(browser, entry.role)
        await page.goto(entry.path())
        await page.waitForLoadState('load')
        // Client-rendered content has to be on the page before it can be audited.
        if (entry.path() === '/map') await page.locator('.leaflet-container').waitFor()
        if (entry.path().startsWith('/w/')) await page.getByText(code).first().waitFor()

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            // Map tiles are third-party imagery drawn by Leaflet, not this product's markup.
            .exclude('.leaflet-tile-container')
            .analyze()

        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        const lesser = results.violations.filter((v) => !serious.includes(v))
        if (lesser.length > 0) {
            console.log(`  ${label}: ${lesser.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`).join(', ')}`)
        }
        expect(
            serious.map(
                (v) =>
                    `${v.id} [${v.impact}] ${v.help} — ${v.nodes.length} node(s): ${v.nodes
                        .slice(0, 3)
                        .map((n) => n.target.join(' '))
                        .join(' | ')}`,
            ),
        ).toEqual([])
    })
}

// The filing wizard is one URL with six screens; the list above audits only the
// first. The location screen carries a map, a pin and the nearby hint, and the
// photo screen a file input and previews, so each is audited where it stands.
test('/file location and photo steps as anon: no serious accessibility violations', async ({ browser }) => {
    const page = await pageAs(browser, 'anon')
    await page.goto('/file')
    await page.getByLabel('Street Condition').check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.fill('#address', 'E2E — accessibility — 1 TEST STREET')
    await page.getByText('Enter coordinates instead').click()
    await page.fill('#lat', '40.6501')
    await page.fill('#lon', '-73.9496')
    await page.locator('.leaflet-marker-icon').waitFor()

    const serious = async () =>
        (
            await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .exclude('.leaflet-tile-container')
                .analyze()
        ).violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)

    expect(await serious()).toEqual([])
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.locator('#request-photos').waitFor()
    expect(await serious()).toEqual([])
})
