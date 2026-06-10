/**
 * Slim, read-only client for the hermes dashboard's PUBLIC `GET /api/status`
 * (the cross-source health rollup: gateway state, per-platform connections,
 * active sessions, config version drift). Unlike the gated dashboard surfaces,
 * `/api/status` needs no session token — so this is deliberately a thin fetch
 * with a same-host `Origin` + a timeout, NOT the full {@link DashboardClient}
 * token dance. We keep it separate so the status route never touches the
 * credentialed code path.
 *
 * Returns the RAW dashboard JSON; the BFF route is responsible for mapping it to
 * the slim, whitelisted DTO (and for never passing filesystem paths through).
 */

export interface StatusClientConfig {
  /** Base URL of the dashboard, e.g. http://127.0.0.1:9123 */
  hermesDashboardUrl: string
  /** Trusted Host header value the dashboard authorizes against, e.g. 127.0.0.1:9123 */
  hermesDashboardHost: string
  /** Timeout (ms) for the status call. Default 5s (it backs a 15s poll). */
  requestTimeoutMs?: number
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

export class StatusError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'StatusError'
  }
}

export class StatusClient {
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(private readonly config: StatusClientConfig) {
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  /** Same-host Origin matching the Host undici sets from the request URL. */
  private origin(): string {
    const scheme = new URL(this.config.hermesDashboardUrl).protocol
    return `${scheme}//${this.config.hermesDashboardHost}`
  }

  /** Fetch the raw `/api/status` JSON (public). Throws {@link StatusError} on
   * timeout, network failure, non-2xx, or non-JSON body. */
  async getStatus(): Promise<Record<string, unknown>> {
    const url = new URL('/api/status', this.config.hermesDashboardUrl)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Origin: this.origin(), Accept: 'application/json' },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      })
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      ) {
        throw new StatusError(`status timed out after ${this.requestTimeoutMs}ms`)
      }
      throw new StatusError(
        `status request failed: ${err instanceof Error ? err.message : 'network error'}`,
      )
    }
    if (!res.ok) {
      throw new StatusError(`GET /api/status failed: HTTP ${res.status}`, res.status)
    }
    const body = (await res.json().catch(() => null)) as unknown
    if (!body || typeof body !== 'object') {
      throw new StatusError('status response was not a JSON object')
    }
    return body as Record<string, unknown>
  }
}
