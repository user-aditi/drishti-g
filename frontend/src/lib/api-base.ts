/**
 * Where the API lives, resolved once.
 *
 * `NEXT_PUBLIC_API_URL` carries the *whole* base including the version prefix
 * — `http://localhost:4000/api/v1` — because the prefix is configurable on the
 * server (`API_PREFIX`) and a client that reassembled it from an origin would
 * silently 404 the moment someone changed it.
 */
const DEFAULT_BASE = 'http://localhost:4000/api/v1'

/** Only the trailing slash is normalised; the path is taken as given. */
const normalise = (base: string): string => base.replace(/\/+$/, '')

/** For code running in the browser. Must be a URL the browser can reach. */
export const BROWSER_API = normalise(process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_BASE)

/**
 * For server components. Inside Docker the API answers on a service name the
 * browser cannot resolve, hence a second variable rather than one shared origin.
 */
export const SERVER_API = normalise(
    process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_BASE,
)

/**
 * Build a query string, dropping anything empty.
 *
 * `false` is dropped along with `undefined`, and that is deliberate rather than
 * sloppy: the API parses its boolean filters with `z.coerce.boolean()`, under
 * which the *string* `"false"` is truthy. Sending `overdue=false` would turn
 * the filter on. An unset flag has to be genuinely absent.
 */
export function toQuery(
    params: Record<string, string | number | boolean | undefined | null>,
): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '' || value === false) continue
        search.set(key, String(value))
    }
    const qs = search.toString()
    return qs ? `?${qs}` : ''
}
