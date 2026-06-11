/**
 * Test-only mock of the hermes loopback dashboard (`:9123`). A tiny local HTTP
 * server that reproduces the auth recipe documented in
 * the stock Hermes dashboard contract so the dashboardClient can be
 * exercised HERMETICALLY — no dependency on the live dashboard.
 *
 * Auth recipe modeled (STOCK hermes v0.15.2 — NOT the retired dashboard
 * overlay):
 *  1. `Host` header must be a trusted hostname (loopback / localhost / private /
 *     `*.ts.net`).
 *  2. An `Origin` OR `Referer` header matching that Host.
 *  3. `GET /` (the SPA root) returns index.html with the ephemeral session token
 *     injected as `window.__HERMES_SESSION_TOKEN__="<token>"` (stock
 *     `web_server.py:_serve_index` / `serve_spa`). Stock has NO
 *     `/api/auth/session-token` endpoint — it 404s. The same-host browser check
 *     (1+2) gates the page; an untrusted Origin gets a 403 with no token.
 *  4. Gated endpoints require `Authorization: Bearer <token>`.
 * `/api/status` is public (no token).
 *
 * NOT shipped: imported only from tests, carries no secrets, binds loopback:0.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'

export interface MockDashboardCall {
  method: string
  path: string
  /** The raw query string (e.g. `?limit=5&order=recent`), '' when none — lets a
   * test assert forwarded query params without parsing the path. */
  search: string
  host: string | undefined
  origin: string | undefined
  referer: string | undefined
  authorization: string | undefined
}

export interface MockDashboardOptions {
  /** Override the host the mock considers trusted. Defaults to its own bound
   * `127.0.0.1:<port>`; tests can also rely on the real host check below. */
  trustedHostSuffixes?: string[]
  /** Canned JSON bodies keyed by path for gated GET routes. */
  routes?: Record<string, unknown>
  /** Canned HTML bodies keyed by path for gated GET routes — models a Hermes whose
   * SPA catch-all serves index.html (200 text/html) for an /api route it does NOT
   * actually implement (version skew). Used to exercise the deck's honest handling. */
  htmlRoutes?: Record<string, string>
  /** Canned JSON bodies keyed by path for gated DELETE routes (e.g.
   * `/api/sessions/{id}`). A matched path returns `{ status: 200, body }`;
   * an unmatched gated DELETE 404s exactly like an unknown GET route. */
  deleteRoutes?: Record<string, unknown>
  /** Canned JSON bodies keyed by path for gated PATCH routes (e.g. rename/archive).
   * A matched path returns 200 with the body; an unmatched gated PATCH 404s. */
  patchRoutes?: Record<string, unknown>
  /** Canned JSON bodies keyed by path for gated POST routes (e.g. prune).
   * A matched path returns 200 with the body; an unmatched gated POST 404s. */
  postRoutes?: Record<string, unknown>
  /** Canned JSON bodies keyed by path for gated PUT routes (e.g.
   * `/api/tools/toolsets/{name}`). A matched path returns `{ status: 200, body }`;
   * an unmatched gated PUT 404s exactly like an unknown GET route. */
  putRoutes?: Record<string, unknown>
  /** Override the PUBLIC `/api/status` body (no token). Defaults to
   * `{ status: 'ok' }`. */
  statusBody?: unknown
  /** Whether the SPA root injects `__HERMES_SESSION_TOKEN__`. Defaults to true.
   * Set false to model an OAuth-gated dashboard, where stock omits the token
   * from index.html (the BFF then cannot derive a token). */
  injectToken?: boolean
}

export interface MockDashboardHandle {
  url: string
  /** The host:port the mock is bound to (use as the Host/Origin in requests). */
  host: string
  /** The token currently handed out (rotates each session-token fetch). */
  lastIssuedToken: string | undefined
  /** Number of times a fresh session token was issued. */
  tokenFetchCount: number
  /** Ordered log of every request the mock received. */
  calls: MockDashboardCall[]
  close(): Promise<void>
}

/** Reproduce the dashboard's trusted-host check: loopback / localhost / private
 * / *.ts.net. The host header may carry a port, which we strip first. */
function isTrustedHost(hostHeader: string | undefined, extraSuffixes: string[]): boolean {
  if (!hostHeader) return false
  const hostname = hostHeader.split(':')[0]!.toLowerCase()
  if (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.endsWith('.ts.net')
  ) {
    return true
  }
  return extraSuffixes.some((s) => hostname === s || hostname.endsWith(s))
}

/** The Origin/Referer must reference the same host the request was sent to. */
function originMatchesHost(
  origin: string | undefined,
  referer: string | undefined,
  hostHeader: string | undefined,
): boolean {
  if (!hostHeader) return false
  const candidate = origin ?? referer
  if (!candidate) return false
  let originHost: string
  try {
    originHost = new URL(candidate).host.toLowerCase()
  } catch {
    return false
  }
  return originHost === hostHeader.toLowerCase()
}

export async function startMockDashboard(
  options: MockDashboardOptions = {},
): Promise<MockDashboardHandle> {
  const extraSuffixes = options.trustedHostSuffixes ?? []
  const routes = options.routes ?? {}
  const htmlRoutes = options.htmlRoutes ?? {}
  const deleteRoutes = options.deleteRoutes ?? {}
  const patchRoutes = options.patchRoutes ?? {}
  const postRoutes = options.postRoutes ?? {}
  const putRoutes = options.putRoutes ?? {}
  const statusBody = options.statusBody ?? { status: 'ok' }
  const injectToken = options.injectToken ?? true
  const calls: MockDashboardCall[] = []
  // The token the mock will currently accept on gated routes.
  let activeToken: string | undefined
  let tokenFetchCount = 0

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const host = req.headers['host']
    const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined
    const referer = typeof req.headers['referer'] === 'string' ? req.headers['referer'] : undefined
    const authorization =
      typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined

    calls.push({
      method: req.method ?? 'GET',
      path,
      search: url.search,
      host,
      origin,
      referer,
      authorization,
    })

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const html = (status: number, body: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html' })
      res.end(body)
    }

    // Public: no token required.
    if (req.method === 'GET' && path === '/api/status') {
      json(200, statusBody)
      return
    }

    // Browser-session check gate for the SPA root (token source) + all gated routes.
    const sessionOk = isTrustedHost(host, extraSuffixes) && originMatchesHost(origin, referer, host)

    // SPA root: stock serves index.html with the ephemeral session token injected
    // as window.__HERMES_SESSION_TOKEN__ (web_server.py:_serve_index). There is NO
    // /api/auth/session-token endpoint in stock — it 404s like any unknown gated path.
    if (req.method === 'GET' && path === '/') {
      if (!sessionOk) {
        json(403, { error: 'forbidden' })
        return
      }
      tokenFetchCount += 1
      if (!injectToken) {
        // OAuth-gated dashboard: no token in the HTML.
        html(200, '<!doctype html><html><head></head><body></body></html>')
        return
      }
      activeToken = `tok_${randomUUID()}`
      html(
        200,
        '<!doctype html><html><head>' +
          `<script>window.__HERMES_SESSION_TOKEN__="${activeToken}";` +
          'window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=false;' +
          'window.__HERMES_BASE_PATH__="";window.__HERMES_AUTH_REQUIRED__=false;</script>' +
          '</head><body></body></html>',
      )
      return
    }

    // Gated routes require a valid bearer token.
    const tokenOk = authorization === `Bearer ${activeToken}` && activeToken !== undefined
    if (!tokenOk) {
      json(401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET' && path in htmlRoutes) {
      // SPA-fallback: a 200 text/html body for an /api path (version skew).
      html(200, htmlRoutes[path] ?? '<!doctype html><html><body></body></html>')
      return
    }

    if (req.method === 'GET' && path in routes) {
      json(200, routes[path])
      return
    }

    if (req.method === 'DELETE' && path in deleteRoutes) {
      json(200, deleteRoutes[path])
      return
    }

    if (req.method === 'PATCH' && path in patchRoutes) {
      json(200, patchRoutes[path])
      return
    }

    if (req.method === 'POST' && path in postRoutes) {
      json(200, postRoutes[path])
      return
    }

    if (req.method === 'PUT' && path in putRoutes) {
      json(200, putRoutes[path])
      return
    }

    json(404, { error: 'not found' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const host = `127.0.0.1:${port}`

  return {
    url: `http://${host}`,
    host,
    get lastIssuedToken() {
      return activeToken
    },
    get tokenFetchCount() {
      return tokenFetchCount
    },
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        server.closeAllConnections?.()
      }),
  }
}
