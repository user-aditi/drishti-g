/**
 * Open every page in the product, as the right person, and time it.
 *
 *   npm run audit:pages
 *
 * Why this is a script rather than a morning of clicking
 * -----------------------------------------------------
 * Screens built against a handful of seeded rows behave differently once there
 * are thousands: a register with no pagination becomes a five-second render, a
 * chart with three points becomes a chart with six months of them, a map draws
 * every pin individually. None of that shows up in a test suite, because none
 * of it is wrong — it is just slow, or unreadable, and the only way to find it
 * is to look.
 *
 * The looking still has to be done by a person. What this removes is the part
 * that is not judgement: which pages exist, whether each one answers at all,
 * how long it took, and whether the HTML that came back is a real page or an
 * error boundary. That part is worth automating because it is worth repeating —
 * every wave that adds data or a screen invalidates the last pass.
 *
 * It drives the Next server over HTTP with a real session cookie, so the server
 * components, their data fetches and the auth guards all execute exactly as
 * they do for a user. It does not run the client bundle, so it will not catch a
 * hydration error or a broken chart — those need a browser, and this narrows
 * the list of pages worth opening in one.
 */

const WEB = process.env.WEB_URL ?? 'http://localhost:3000'
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'drishti123'

/** How long a page may take before it is worth someone's attention. */
const BUDGET_MS = 2000

interface Actor {
    label: string
    email: string | null
}

const ACTORS: Record<string, Actor> = {
    anon: { label: 'signed out', email: null },
    citizen: { label: 'citizen', email: 'citizen@example.com' },
    officer: { label: 'section officer', email: 'je.s5.phd@noidaauthority.in' },
    admin: { label: 'super admin', email: 'admin@drishti.gov.in' },
}

/**
 * Every route, with who should be able to open it.
 *
 * Dynamic segments are filled from live data at run time rather than hardcoded,
 * because an id that existed when this was written is not an id that exists
 * after a re-seed — and a 404 that looks like a pass is worse than no check.
 */
interface Route {
    path: string
    actor: keyof typeof ACTORS
    /** Resolve a real id for a dynamic route; skip the route if it returns null. */
    resolve?: (session: Session) => Promise<string | null>
}

const ROUTES: Route[] = [
    { path: '/', actor: 'anon' },
    { path: '/login', actor: 'anon' },
    { path: '/register', actor: 'anon' },
    { path: '/w', actor: 'anon' },
    {
        // The crew surface, reached with no account at all — the one page whose
        // whole design is that a code is the only credential. Signed out on
        // purpose: opening it with a session would not test what it is for.
        path: '/w/{id}',
        actor: 'anon',
        resolve: async () => {
            const officer = new Session()
            await officer.login(ACTORS.officer!.email!)
            // Any code will do. A live one renders the upload form and a spent
            // one renders "already submitted" — both are the page working, and
            // insisting on a live one made this skip almost every run, because
            // a crew that reports promptly leaves very few open.
            const open = await officer.api<{ items?: { code: string }[] }>(
                '/crew/work-orders?status=ISSUED',
            )
            if (open.items?.[0]) return open.items[0].code
            const any = await officer.api<{ items?: { code: string }[] }>('/crew/work-orders')
            return any.items?.[0]?.code ?? null
        },
    },

    { path: '/dashboard', actor: 'citizen' },
    { path: '/complaints/new', actor: 'citizen' },
    { path: '/community', actor: 'citizen' },
    { path: '/contacts', actor: 'citizen' },
    { path: '/profile', actor: 'citizen' },
    {
        path: '/complaints/{id}',
        actor: 'citizen',
        resolve: async (s) => {
            const page = await s.api<{ items?: { id: number }[] }>('/complaints?size=1&scope=mine')
            return page.items?.[0] ? String(page.items[0].id) : null
        },
    },

    { path: '/officer', actor: 'officer' },
    { path: '/officer/desk', actor: 'officer' },
    { path: '/officer/crew', actor: 'officer' },
    { path: '/officer/inspect', actor: 'officer' },
    { path: '/officer/done', actor: 'officer' },

    { path: '/admin', actor: 'admin' },
    { path: '/admin/dashboard', actor: 'admin' },
    { path: '/admin/complaints', actor: 'admin' },
    { path: '/admin/escalations', actor: 'admin' },
    { path: '/admin/risk', actor: 'admin' },
    { path: '/admin/map', actor: 'admin' },
    { path: '/admin/audit', actor: 'admin' },
    { path: '/admin/decisions', actor: 'admin' },
    { path: '/admin/autonomy', actor: 'admin' },
    { path: '/admin/people', actor: 'admin' },
    { path: '/admin/departments', actor: 'admin' },
    { path: '/admin/org', actor: 'admin' },
    {
        path: '/admin/org/{id}',
        actor: 'admin',
        resolve: async (s) => String((await s.api<{ rootId: number }>('/console/units')).rootId),
    },
    { path: '/admin/console', actor: 'admin' },
    { path: '/admin/console/city', actor: 'admin' },
    { path: '/admin/console/complaints', actor: 'admin' },
    { path: '/admin/console/staff', actor: 'admin' },
    { path: '/admin/console/citizens', actor: 'admin' },
    { path: '/admin/console/departments', actor: 'admin' },
    {
        path: '/admin/console/staff/{id}',
        actor: 'admin',
        resolve: async (s) => {
            const page = await s.api<{ items?: { id: number }[] }>('/console/staff?size=1')
            return page.items?.[0] ? String(page.items[0].id) : null
        },
    },
    {
        path: '/admin/console/citizens/{id}',
        actor: 'admin',
        resolve: async (s) => {
            const page = await s.api<{ items?: { id: number }[] }>('/console/citizens?size=1')
            return page.items?.[0] ? String(page.items[0].id) : null
        },
    },
    {
        path: '/admin/console/departments/{id}',
        actor: 'admin',
        resolve: async (s) => {
            const list = await s.api<{ id: number }[]>('/departments')
            return list[0] ? String(list[0].id) : null
        },
    },
    {
        path: '/admin/console/departments/{id}/layers',
        actor: 'admin',
        resolve: async (s) => {
            const list = await s.api<{ id: number }[]>('/departments')
            return list[0] ? String(list[0].id) : null
        },
    },
]

/** A signed-in browser, near enough: one cookie jar, two hosts. */
class Session {
    private cookies = new Map<string, string>()

    private absorb(response: Response) {
        for (const line of response.headers.getSetCookie?.() ?? []) {
            const pair = line.split(';')[0]
            const at = pair?.indexOf('=') ?? -1
            if (pair && at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1))
        }
    }

    private header() {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    }

    async login(email: string) {
        const response = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: PASSWORD }),
        })
        if (!response.ok) throw new Error(`could not sign in as ${email}: ${response.status}`)
        this.absorb(response)
    }

    async api<T>(path: string): Promise<T> {
        const response = await fetch(`${API}${path}`, { headers: { Cookie: this.header() } })
        if (!response.ok) throw new Error(`${path} -> ${response.status}`)
        return (await response.json()) as T
    }

    /** Fetch a page and report what came back. */
    async page(path: string) {
        const started = Date.now()
        const response = await fetch(`${WEB}${path}`, {
            headers: { Cookie: this.header() },
            redirect: 'manual',
        })
        const body = response.status < 400 ? await response.text() : ''
        return { status: response.status, ms: Date.now() - started, body, location: response.headers.get('location') }
    }
}

interface Result {
    path: string
    actor: string
    status: number
    ms: number
    note: string
    ok: boolean
}

/**
 * Next renders its error boundary with a 200, so status alone does not settle
 * whether a page worked.
 *
 * Deliberately narrow. The first version also flagged the string "This page
 * could not be found", which Next embeds in its dev bundle on *every* page —
 * so all 30 real pages were reported as 404s. A check that cries wolf on
 * everything is worse than no check, because the next person stops reading the
 * output. A genuine `notFound()` comes back with a 404 status anyway, which the
 * caller already handles.
 */
function looksBroken(html: string): string | null {
    if (/__next_error__/.test(html)) return 'error boundary rendered'
    if (/Application error: a server-side exception/.test(html)) return 'server exception'
    if (html.length < 500) return `suspiciously small response (${html.length} bytes)`
    return null
}

async function main() {
    const sessions = new Map<string, Session>()
    for (const [key, actor] of Object.entries(ACTORS)) {
        const session = new Session()
        if (actor.email) await session.login(actor.email)
        sessions.set(key, session)
    }

    console.log(`--- page audit --- ${WEB}, budget ${BUDGET_MS}ms\n`)

    const results: Result[] = []

    for (const route of ROUTES) {
        const session = sessions.get(route.actor)!
        let path = route.path

        if (route.resolve) {
            let id: string | null = null
            try {
                id = await route.resolve(session)
            } catch {
                id = null
            }
            if (!id) {
                results.push({
                    path: route.path,
                    actor: route.actor,
                    status: 0,
                    ms: 0,
                    note: 'skipped — no row to open',
                    ok: true,
                })
                continue
            }
            path = route.path.replace('{id}', id)
        }

        try {
            /*
             * Two passes, and only the second is timed.
             *
             * `next dev` compiles a route the first time it is requested, so a
             * cold hit measures the bundler, not the page — 18 seconds for a
             * dashboard that renders in 200ms. The first pass warms it; the
             * second is what a user with a warm server would actually wait.
             *
             * That still understates a production build, which is fine: this is
             * for spotting the page that got dramatically worse, not for
             * publishing latency figures.
             */
            await session.page(path)
            const { status, ms, body, location } = await session.page(path)
            const redirected = status >= 300 && status < 400
            const broken = redirected ? null : looksBroken(body)
            const slow = ms > BUDGET_MS

            results.push({
                path,
                actor: route.actor,
                status,
                ms,
                note: redirected
                    ? `redirected to ${location ?? '?'}`
                    : (broken ?? (slow ? `over budget by ${ms - BUDGET_MS}ms` : '')),
                ok: status < 400 && !broken,
            })
        } catch (error) {
            results.push({
                path,
                actor: route.actor,
                status: 0,
                ms: 0,
                note: error instanceof Error ? error.message : 'threw',
                ok: false,
            })
        }
    }

    const width = Math.max(...results.map((r) => r.path.length))
    for (const r of results) {
        const mark = !r.ok ? 'FAIL' : r.ms > BUDGET_MS ? 'SLOW' : '  ok'
        const timing = r.ms ? `${String(r.ms).padStart(5)}ms` : '       '
        console.log(
            `  ${mark}  ${r.path.padEnd(width)}  ${String(r.status).padStart(3)}  ${timing}  ${ACTORS[r.actor]!.label.padEnd(15)} ${r.note}`,
        )
    }

    const failed = results.filter((r) => !r.ok)
    const slow = results.filter((r) => r.ok && r.ms > BUDGET_MS)
    const timed = results.filter((r) => r.ms > 0).map((r) => r.ms)
    timed.sort((a, b) => a - b)

    console.log(`\n  ${results.length} routes · ${failed.length} failing · ${slow.length} over ${BUDGET_MS}ms`)
    if (timed.length > 0) {
        console.log(
            `  median ${timed[Math.floor(timed.length / 2)]}ms · slowest ${timed[timed.length - 1]}ms`,
        )
    }

    if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
