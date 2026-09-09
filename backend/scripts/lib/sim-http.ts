/**
 * A tiny HTTP client with a cookie jar, one per simulated actor.
 *
 * The simulator drives the real API rather than writing rows, and the session
 * lives in an httpOnly cookie, so each synthetic citizen and each real officer
 * needs its own jar. `fetch` in Node does not keep cookies, so this does.
 *
 * Nothing here is clever. It exists so the simulator's own code reads as
 * "this citizen filed a complaint" rather than as header bookkeeping.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} -> ${status}: ${body.slice(0, 300)}`)
    this.name = 'ApiError'
  }
}

/** One actor's session. Cookies are kept by name; the newest write wins. */
export class Session {
  private cookies = new Map<string, string>()

  constructor(
    readonly baseUrl: string,
    readonly label: string,
  ) {}

  private header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  private absorb(response: Response): void {
    // Node exposes multiple Set-Cookie headers through getSetCookie().
    const raw = response.headers.getSetCookie?.() ?? []
    for (const line of raw) {
      const [pair] = line.split(';')
      const index = pair?.indexOf('=') ?? -1
      if (!pair || index <= 0) continue
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { raw?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {}
    const jar = this.header()
    if (jar) headers.Cookie = jar

    let payload: BodyInit | undefined
    if (body instanceof FormData) {
      payload = body
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    const response = await fetch(`${this.baseUrl}${path}`, { method, headers, body: payload })
    this.absorb(response)

    if (!response.ok) {
      throw new ApiError(response.status, method, path, await response.text())
    }

    if (response.status === 204) return undefined as T
    if (options.raw) return (await response.text()) as T
    return (await response.json()) as T
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }
}

/** Wait for the API to answer, so a run against a dead server fails clearly. */
export async function waitForApi(baseUrl: string, attempts = 20): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `The API at ${baseUrl} did not answer. Start it first:  npm --prefix backend run dev`,
  )
}
