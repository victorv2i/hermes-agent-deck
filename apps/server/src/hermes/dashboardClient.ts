/**
 * Server-side client for the loopback hermes dashboard (stock default
 * `http://127.0.0.1:9119`). The dashboard exposes session / agent / skill
 * / config / workspace data behind a same-host browser-session check.
 *
 * Authoritative contract: the stock Hermes dashboard contract §"DASHBOARD
 * DATA API — auth recipe + real routes".
 *
 * Auth recipe (server-side):
 *  1. A trusted `Host` header (the bound dashboard host, e.g. `127.0.0.1:9123`).
 *     Node's fetch/undici sets `Host` from the request URL's authority and ignores
 *     any `Host` we put in `headers`, so we satisfy this simply by addressing the
 *     dashboard at its trusted URL — `hermesDashboardHost` documents the expected
 *     authority and drives the matching `Origin` below.
 *  2. A same-host `Origin` matching that Host (this we DO control).
 *  3. `GET /` (the SPA root) returns index.html with the ephemeral session token
 *     injected as `window.__HERMES_SESSION_TOKEN__="<token>"` (stock
 *     `hermes_cli/web_server.py:_serve_index` / `serve_spa`). We read it from the
 *     HTML and cache it. Stock has NO `/api/auth/session-token` endpoint — it was
 *     removed (the token moved into the page), so calling it 404s. When the
 *     dashboard runs behind the OAuth gate the token is NOT injected; we then
 *     surface a clear error rather than send an empty Bearer.
 *  4. Use it as `Authorization: Bearer <token>` on gated calls.
 *
 * The session token is ephemeral and per-process on the dashboard side; we cache
 * it and transparently re-fetch once on a 401 (token rotated / process restarted).
 *
 * SECURITY: the session token is treated like a credential — it is NEVER logged,
 * printed, or surfaced to the browser. Only its presence/shape may be mentioned.
 *
 * Feature-specific typed wrappers (sessions, agents, skills, config, workspace)
 * are layered on top of {@link DashboardClient.authedFetch} per-feature later.
 */

export interface DashboardClientConfig {
  /** Base URL of the dashboard, e.g. http://127.0.0.1:9123 */
  hermesDashboardUrl: string
  /** Trusted Host header value the dashboard authorizes against, e.g. 127.0.0.1:9123 */
  hermesDashboardHost: string
  /** Timeout (ms) for dashboard calls. Default 15s. */
  requestTimeoutMs?: number
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

/**
 * Extract the ephemeral session token stock injects into index.html as
 * `window.__HERMES_SESSION_TOKEN__="<token>"` (web_server.py:_serve_index). The
 * token is `secrets.token_urlsafe(32)` — URL-safe base64 (`A-Za-z0-9_-`). Returns
 * the token, or `null` when the marker is absent (e.g. an OAuth-gated dashboard
 * that omits the token from the page). Pure + exported so it is unit-testable.
 */
export function extractInjectedSessionToken(html: string): string | null {
  const m = html.match(/window\.__HERMES_SESSION_TOKEN__\s*=\s*"([A-Za-z0-9_-]+)"/)
  return m ? m[1]! : null
}

export class DashboardError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'DashboardError'
  }
}

export class DashboardClient {
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch
  /** Cached ephemeral session token. Never logged. */
  private sessionToken: string | null = null
  /** Dedupe concurrent token fetches into a single in-flight request. */
  private tokenInFlight: Promise<string> | null = null

  constructor(private readonly config: DashboardClientConfig) {
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  private url(path: string): URL {
    return new URL(path, this.config.hermesDashboardUrl)
  }

  /**
   * The same-host `Origin` we present. Derived from `hermesDashboardHost` so it
   * matches the `Host` the dashboard sees (the request URL's authority). We infer
   * the scheme from the configured dashboard URL.
   */
  private origin(): string {
    const scheme = new URL(this.config.hermesDashboardUrl).protocol
    return `${scheme}//${this.config.hermesDashboardHost}`
  }

  /** The same-host Origin every dashboard call carries (Host is set by undici). */
  private sessionHeaders(): Record<string, string> {
    return { Origin: this.origin() }
  }

  private async timedFetch(url: URL, init: RequestInit, label: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      })
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      ) {
        throw new DashboardError(`${label} timed out after ${this.requestTimeoutMs}ms`)
      }
      throw new DashboardError(
        `${label} request failed: ${err instanceof Error ? err.message : 'network error'}`,
      )
    }
  }

  /**
   * Fetch (and cache) the ephemeral session token via the same-host browser
   * check. Stock injects the token into the SPA's index.html as
   * `window.__HERMES_SESSION_TOKEN__="<token>"`, so we GET `/` and parse it out
   * of the HTML. Concurrent callers share a single in-flight fetch. The token
   * value is never logged.
   */
  private async fetchSessionToken(): Promise<string> {
    if (this.tokenInFlight) return this.tokenInFlight
    this.tokenInFlight = (async () => {
      const res = await this.timedFetch(
        this.url('/'),
        { method: 'GET', headers: { ...this.sessionHeaders(), Accept: 'text/html' } },
        'session-token',
      )
      if (!res.ok) {
        // GET / is the stock token-bootstrap (the SPA root serves index.html
        // with __HERMES_SESSION_TOKEN__ injected). A non-2xx here means the
        // dashboard can't serve its SPA — most commonly its HERMES_WEB_DIST
        // points at a missing/unbuilt bundle, so _serve_index 500s. Surface
        // that precisely: without the page there is no token to bootstrap, so
        // every gated dashboard surface (sessions/workspace/models/usage) is
        // dark until the dashboard can serve its index.
        throw new DashboardError(
          `dashboard session-token bootstrap failed: GET / returned HTTP ${res.status} ` +
            `(the dashboard SPA index is unavailable, so no session token can be read). ` +
            `Check the dashboard's web bundle (HERMES_WEB_DIST) and that GET ${this.config.hermesDashboardUrl}/ serves index.html.`,
          res.status,
        )
      }
      const body = await res.text().catch(() => '')
      const token = extractInjectedSessionToken(body)
      if (token === null) {
        // The SPA root served OK but carried no token. Either an OAuth-gated
        // dashboard (stock omits the token from the page when auth_required) or
        // an unexpected body. The page body is NOT included in the error — it
        // could carry the token on a malformed match.
        throw new DashboardError(
          'dashboard session-token bootstrap failed: GET / served HTML but did not inject ' +
            'window.__HERMES_SESSION_TOKEN__ (an OAuth-gated dashboard omits it; ' +
            'this BFF needs a loopback/--insecure dashboard).',
        )
      }
      this.sessionToken = token
      return token
    })()
    try {
      return await this.tokenInFlight
    } finally {
      this.tokenInFlight = null
    }
  }

  /** Return the cached token, fetching one if absent. */
  private async ensureToken(): Promise<string> {
    if (this.sessionToken) return this.sessionToken
    return this.fetchSessionToken()
  }

  /**
   * Perform an authenticated request against the dashboard. Sends the
   * browser-session headers + a `Authorization: Bearer <token>`, fetching a token
   * first when needed. On a 401 (rotated/expired token) it re-fetches the token
   * once and retries; a second 401 surfaces as a {@link DashboardError}.
   *
   * Returns the raw Response so per-feature wrappers control parsing.
   */
  async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = async (token: string): Promise<Response> => {
      const headers = new Headers(init.headers)
      headers.set('Origin', this.origin())
      headers.set('Authorization', `Bearer ${token}`)
      return this.timedFetch(this.url(path), { ...init, headers }, `dashboard ${path}`)
    }

    let token = await this.ensureToken()
    let res = await send(token)
    if (res.status === 401) {
      // Token likely rotated (dashboard regenerates it per-process). Drop the
      // cached value, fetch a fresh one, and retry exactly once.
      this.sessionToken = null
      token = await this.fetchSessionToken()
      res = await send(token)
    }
    return res
  }

  /**
   * Convenience JSON wrapper around {@link authedFetch}: throws on non-2xx and
   * parses the body as JSON. Per-feature typed wrappers can build on either this
   * or `authedFetch` directly.
   */
  async getJson<T>(path: string): Promise<T> {
    const res = await this.authedFetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new DashboardError(`GET ${path} failed: HTTP ${res.status}`, res.status)
    }
    // A 2xx NON-JSON body means the dashboard served its SPA catch-all for this path
    // — i.e. THIS Hermes build does not actually serve this route (VERSION SKEW).
    // Surface it as a clean DashboardError so callers degrade honestly ("not served
    // by this Hermes") instead of crashing on a JSON-parse of HTML, which would
    // otherwise surface as an opaque internal 500.
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) {
      throw new DashboardError(
        `GET ${path}: this Hermes did not serve the route (non-JSON response).`,
        res.status,
      )
    }
    return (await res.json()) as T
  }

  /**
   * Convenience JSON wrapper for an authenticated POST: serializes `body`, throws
   * on non-2xx (status preserved on the {@link DashboardError}), and parses the
   * response as JSON. The session token (handled by {@link authedFetch}) never
   * appears in the thrown message.
   */
  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.authedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new DashboardError(`POST ${path} failed: HTTP ${res.status}`, res.status)
    }
    return (await res.json()) as T
  }

  /**
   * Convenience JSON wrapper for an authenticated PUT — the mirror of
   * {@link postJson}. Used by the guarded config-field write (read-modify-write
   * against stock `PUT /api/config`). The session token never appears in the
   * thrown message.
   */
  async putJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.authedFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new DashboardError(`PUT ${path} failed: HTTP ${res.status}`, res.status)
    }
    return (await res.json()) as T
  }
}
