/**
 * Open every page in the product, as the right person and as the wrong one.
 *
 *   npm run audit:pages          (needs the API on :4000 and the web app on :3000)
 *
 * What it checks
 * --------------
 * Every route the production build emits, opened by the role it is for, over
 * HTTP with a real session cookie — so the server components, their data fetches
 * and the auth guards all run exactly as they do for a user. Each page must come
 * back as a real page: not an error status, not Next's error boundary (which
 * arrives with a 200), and not a stub.
 *
 * Then the other half, which the previous version of this script never asked:
 * the wrong person opening a page must be turned away. An officer who can read
 * the risk register, or a signed-out visitor who can open the officer's queue,
 * is a failure no page-load check would notice, because the page loads fine.
 *
 * Why it lives in the backend
 * ---------------------------
 * The version this replaces signed in with hardcoded NOIDA accounts and a
 * hardcoded password, and silently stopped working when the product was rebuilt
 * on NYC data — none of its accounts existed and most of its forty routes had
 * been deleted. This one resolves its people and its ids from the database it is
 * auditing, and signs sessions with the backend's own key, so it cannot drift
 * from the accounts that exist and it never needs a password.
 *
 * What it does not check: anything that only happens in the browser — a
 * hydration error, a map that fails to draw, an image that will not load. Those
 * need a browser; this narrows the list of pages worth opening in one.
 */
import { Role } from '@prisma/client'
import { ACCESS_COOKIE, signToken } from '../src/lib/auth.js'
import { prisma } from '../src/lib/prisma.js'

const WEB = process.env.WEB_URL ?? 'http://localhost:3000'

/** How long a page may take, warm, before it is worth someone's attention. */
const BUDGET_MS = 2000

type Actor = 'anon' | 'citizen' | 'agent' | 'officer' | 'supervisor' | 'commissioner' | 'admin'

/** The seeded account each actor signs in as. Every one is synthetic. */
const EMAILS: Record<Exclude<Actor, 'anon'>, string> = {
  citizen: 'resident@synthetic.drishti.invalid',
  agent: 'dot.agent@synthetic.drishti.invalid',
  officer: 'dot.officer.bk04@synthetic.drishti.invalid',
  supervisor: 'dot.supervisor@synthetic.drishti.invalid',
  commissioner: 'dot.commissioner@synthetic.drishti.invalid',
  admin: 'admin@synthetic.drishti.invalid',
}

interface Ids {
  /** An imported DOT request, for pages any agent of that agency may open. */
  dotSr: string
  /** A request this officer answers for. */
  officerSr: string
  /** Any work-order code. */
  code: string
  /** The officer, for the person page. */
  officerId: number
}

interface Check {
  path: string
  actor: Actor
  /** `page` must render; `denied` must redirect or refuse rather than render. */
  expect: 'page' | 'denied'
}

function checks(ids: Ids): Check[] {
  const page = (path: string, actor: Actor): Check => ({ path, actor, expect: 'page' })
  const denied = (path: string, actor: Actor): Check => ({ path, actor, expect: 'denied' })

  return [
    // --- Layer 0: the replica ---------------------------------------------------
    page('/', 'anon'),
    page('/file', 'anon'),
    page('/login', 'anon'),
    page('/register', 'anon'),
    page(`/sr/${ids.dotSr}`, 'anon'),
    page('/my/requests', 'citizen'),
    page('/notifications', 'citizen'),
    page('/account', 'citizen'),
    page('/notifications', 'officer'),
    page('/account', 'admin'),
    page('/agency/queue', 'agent'),
    page(`/agency/sr/${ids.dotSr}`, 'agent'),
    page('/boards', 'agent'),
    page('/map', 'agent'),
    // Public since Phase 11: counts over NYC Open Data, for residents too.
    page('/boards', 'anon'),
    page('/map', 'anon'),
    page('/boards', 'supervisor'),
    page('/map', 'commissioner'),

    // --- Layer 1: officer identity ------------------------------------------------
    page('/officer/desk', 'officer'),
    page(`/officer/sr/${ids.officerSr}`, 'officer'),
    page('/supervisor/assign', 'supervisor'),
    // The crew surface is opened signed out on purpose: a code is the only
    // credential it has, and opening it with a session would not test that.
    page('/w', 'anon'),
    page(`/w/${ids.code}`, 'anon'),

    // --- Layer 2: escalation ------------------------------------------------------
    page('/supervisor/escalations', 'supervisor'),
    page('/supervisor/escalations', 'commissioner'),

    // --- Layer 3: the admin console -------------------------------------------------
    page('/admin/risk', 'admin'),
    page('/admin/routing', 'admin'),
    page('/admin/audit', 'admin'),
    page('/admin/people', 'admin'),
    page(`/admin/people/${ids.officerId}`, 'admin'),
    page('/admin/system', 'admin'),

    // --- Layer 4: photo verification --------------------------------------------------
    page('/officer/verify', 'officer'),
    page('/officer/verify', 'supervisor'),

    // --- The wrong person -------------------------------------------------------------
    // Signed out, every staff surface must send you away.
    denied('/agency/queue', 'anon'),
    denied('/officer/desk', 'anon'),
    denied('/officer/verify', 'anon'),
    denied('/supervisor/assign', 'anon'),
    denied('/admin/risk', 'anon'),
    denied('/admin/people', 'anon'),
    denied('/notifications', 'anon'),
    denied('/account', 'anon'),
    // Signed in as the wrong role. The risk register is a model's statement about
    // the people who work at a board, and N13 keeps it from the agencies scored.
    denied('/admin/risk', 'officer'),
    denied('/admin/audit', 'supervisor'),
    denied('/agency/queue', 'citizen'),
    denied('/officer/verify', 'citizen'),
    denied('/supervisor/escalations', 'officer'),
    denied('/admin/people', 'supervisor'),
    denied('/admin/system', 'commissioner'),
    denied(`/admin/people/${ids.officerId}`, 'officer'),
  ]
}

async function resolveIds(): Promise<Ids> {
  const officer = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.officer } })
  const [dot, mine, order] = await Promise.all([
    prisma.serviceRequest.findFirst({
      where: { isImported: true, agency: { code: 'DOT' } },
      select: { srNumber: true },
      orderBy: { id: 'asc' },
    }),
    prisma.serviceRequest.findFirst({
      where: { assignedOfficerId: officer.id },
      select: { srNumber: true },
      orderBy: { id: 'desc' },
    }),
    prisma.workOrder.findFirst({ select: { code: true }, orderBy: { id: 'desc' } }),
  ])
  if (!dot || !mine || !order) {
    throw new Error(
      'The database has nothing to open: import the corpus and seed the staff first ' +
        `(DOT request: ${Boolean(dot)}, officer request: ${Boolean(mine)}, work order: ${Boolean(order)})`,
    )
  }
  return { dotSr: dot.srNumber, officerSr: mine.srNumber, code: order.code, officerId: officer.id }
}

/** A session cookie for an actor, signed with the backend's own key. */
async function cookieFor(actor: Actor): Promise<string | null> {
  if (actor === 'anon') return null
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS[actor] } })
  return `${ACCESS_COOKIE}=${signToken(user.id, 'access', user.role as Role)}`
}

async function fetchPage(path: string, cookie: string | null) {
  const started = Date.now()
  const response = await fetch(`${WEB}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  })
  const body = response.status < 400 ? await response.text() : ''
  return {
    status: response.status,
    ms: Date.now() - started,
    body,
    location: response.headers.get('location'),
  }
}

/**
 * Next renders its error boundary with a 200, so status alone does not settle
 * whether a page worked.
 *
 * Kept deliberately narrow, as the previous version learned: it once flagged
 * the string "This page could not be found", which Next embeds in its dev bundle
 * on every page, and reported all thirty real pages as broken. A genuine
 * `notFound()` returns a 404 anyway.
 */
function looksBroken(html: string): string | null {
  if (/__next_error__/.test(html)) return 'error boundary rendered'
  if (/Application error: a server-side exception/.test(html)) return 'server exception'
  if (html.length < 500) return `suspiciously small response (${html.length} bytes)`
  return null
}

interface Result {
  check: Check
  status: number
  ms: number
  ok: boolean
  note: string
}

async function run(check: Check, cookie: string | null): Promise<Result> {
  try {
    // Two passes, only the second timed: `next dev` compiles a route on first
    // request, so a cold hit measures the bundler rather than the page.
    await fetchPage(check.path, cookie)
    const { status, ms, body, location } = await fetchPage(check.path, cookie)
    const redirected = status >= 300 && status < 400

    if (check.expect === 'denied') {
      // Turned away means a redirect (to sign-in, or to the viewer's own home) or
      // a refusal status. Rendering the page is the failure.
      const turnedAway = redirected || status === 401 || status === 403 || status === 404
      return {
        check,
        status,
        ms,
        ok: turnedAway,
        note: turnedAway
          ? redirected
            ? `turned away to ${location ?? '?'}`
            : `refused (${status})`
          : 'RENDERED FOR THE WRONG PERSON',
      }
    }

    if (redirected) {
      return { check, status, ms, ok: false, note: `redirected to ${location ?? '?'} instead of rendering` }
    }
    const broken = status < 400 ? looksBroken(body) : `status ${status}`
    return {
      check,
      status,
      ms,
      ok: !broken,
      note: broken ?? (ms > BUDGET_MS ? `over budget by ${ms - BUDGET_MS}ms` : ''),
    }
  } catch (err) {
    return {
      check,
      status: 0,
      ms: 0,
      ok: false,
      note: err instanceof Error ? `could not reach ${WEB}: ${err.message}` : 'threw',
    }
  }
}

async function main() {
  const ids = await resolveIds()
  const cookies = new Map<Actor, string | null>()
  for (const actor of ['anon', ...Object.keys(EMAILS)] as Actor[]) {
    cookies.set(actor, await cookieFor(actor))
  }

  console.log(`--- page audit --- ${WEB}, warm budget ${BUDGET_MS}ms`)
  console.log(`  opening ${ids.dotSr} (imported DOT), ${ids.officerSr} (the officer's), job ${ids.code}\n`)

  const results: Result[] = []
  for (const check of checks(ids)) results.push(await run(check, cookies.get(check.actor)!))

  const width = Math.max(...results.map((r) => r.check.path.length))
  let section = ''
  for (const r of results) {
    const heading = r.check.expect === 'page' ? 'Pages, as the person each is for' : 'The wrong person'
    if (heading !== section) {
      console.log(`\n  ${heading}`)
      section = heading
    }
    const mark = !r.ok ? 'FAIL' : r.check.expect === 'page' && r.ms > BUDGET_MS ? 'SLOW' : '  ok'
    const timing = r.ms ? `${String(r.ms).padStart(5)}ms` : '       '
    console.log(
      `  ${mark}  ${r.check.path.padEnd(width)}  ${String(r.status).padStart(3)}  ${timing}  ${r.check.actor.padEnd(12)} ${r.note}`,
    )
  }

  const failed = results.filter((r) => !r.ok)
  const pages = results.filter((r) => r.check.expect === 'page' && r.ms > 0).map((r) => r.ms)
  pages.sort((a, b) => a - b)
  const slow = results.filter((r) => r.ok && r.check.expect === 'page' && r.ms > BUDGET_MS)

  console.log(
    `\n  ${results.length} checks · ${failed.length} failing · ${slow.length} over ${BUDGET_MS}ms` +
      (pages.length ? ` · median page ${pages[Math.floor(pages.length / 2)]}ms, slowest ${pages[pages.length - 1]}ms` : ''),
  )
  process.exitCode = failed.length === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
