import { describe, it, expect, afterEach } from 'vitest'
import { DashboardClient, DashboardError } from './dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from './mockDashboard.test-support'

let dashboard: MockDashboardHandle | undefined
afterEach(async () => {
  await dashboard?.close()
  dashboard = undefined
})

function clientFor(d: MockDashboardHandle): DashboardClient {
  return new DashboardClient({ hermesDashboardUrl: d.url, hermesDashboardHost: d.host })
}

describe('DashboardClient', () => {
  it('reads the injected session token from the SPA root (GET /) then calls a gated route with Bearer auth', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/sessions': { sessions: [{ id: 's1' }] } },
    })
    const client = clientFor(dashboard)

    const body = await client.getJson<{ sessions: { id: string }[] }>('/api/sessions')

    expect(body.sessions).toEqual([{ id: 's1' }])
    // One token fetch (GET /) + one gated call.
    expect(dashboard.tokenFetchCount).toBe(1)
    // Stock has NO /api/auth/session-token endpoint (it 404s); the token is
    // injected into index.html as window.__HERMES_SESSION_TOKEN__. We must read
    // it from the SPA root, never from the retired endpoint.
    expect(dashboard.calls.some((c) => c.path === '/api/auth/session-token')).toBe(false)
    const tokenCall = dashboard.calls.find((c) => c.path === '/')!
    expect(tokenCall.host).toBe(dashboard.host)
    expect(tokenCall.origin).toBe(`http://${dashboard.host}`)
    expect(tokenCall.authorization).toBeUndefined()
    const gated = dashboard.calls.find((c) => c.path === '/api/sessions')!
    expect(gated.authorization).toBe(`Bearer ${dashboard.lastIssuedToken}`)
  })

  it('surfaces a clear DashboardError when the SPA root omits the token (OAuth-gated dashboard)', async () => {
    // When the dashboard runs behind the OAuth gate, stock does NOT inject
    // __HERMES_SESSION_TOKEN__ into index.html. The BFF cannot derive a token
    // and must fail loudly rather than send an empty Bearer.
    dashboard = await startMockDashboard({ injectToken: false })
    const client = clientFor(dashboard)
    await expect(client.getJson('/api/sessions')).rejects.toBeInstanceOf(DashboardError)
  })

  it('throws a clean DashboardError (not a JSON-parse crash) when the dashboard SPA-fallbacks an /api route (version skew)', async () => {
    // The token bootstrap (GET /) works, but this Hermes build does not serve
    // /api/pairing, so its SPA catch-all returns 200 text/html. getJson must detect
    // the non-JSON body and surface a DashboardError, not blow up parsing HTML.
    dashboard = await startMockDashboard({
      htmlRoutes: { '/api/pairing': '<!doctype html><html><body>app</body></html>' },
    })
    const client = clientFor(dashboard)
    await expect(client.getJson('/api/pairing')).rejects.toBeInstanceOf(DashboardError)
    await expect(client.getJson('/api/pairing')).rejects.toThrow(/did not serve the route/i)
  })

  it('caches the token across calls (only one session-token fetch)', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/agents': { agents: [] }, '/api/skills': { skills: [] } },
    })
    const client = clientFor(dashboard)

    await client.getJson('/api/agents')
    await client.getJson('/api/skills')

    expect(dashboard.tokenFetchCount).toBe(1)
  })

  it('dedupes concurrent first calls into a single token fetch', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/sessions': { ok: true }, '/api/agents': { ok: true } },
    })
    const client = clientFor(dashboard)

    await Promise.all([client.getJson('/api/sessions'), client.getJson('/api/agents')])

    expect(dashboard.tokenFetchCount).toBe(1)
  })

  it('re-fetches the token and retries once on a 401 (rotated token)', async () => {
    dashboard = await startMockDashboard({ routes: { '/api/sessions': { ok: true } } })
    const client = clientFor(dashboard)

    // Prime a valid cached token (issue #1).
    await client.getJson('/api/sessions')
    const firstToken = dashboard.lastIssuedToken
    // Poison the cache with a stale value so the next gated call presents a
    // bearer the mock no longer accepts → drives the 401-retry path.
    ;(client as unknown as { sessionToken: string | null }).sessionToken = 'tok_stale'

    const body = await client.getJson<{ ok: boolean }>('/api/sessions')
    expect(body.ok).toBe(true)
    // Stale bearer 401'd → token re-fetched (issue #2) → retry succeeded.
    expect(dashboard.tokenFetchCount).toBe(2)
    expect(dashboard.lastIssuedToken).not.toBe(firstToken)
  })

  it('throws a DashboardError on a non-2xx gated response (after the retry)', async () => {
    dashboard = await startMockDashboard() // no routes → gated paths 404 (token still valid)
    const client = clientFor(dashboard)
    await expect(client.getJson('/api/sessions')).rejects.toBeInstanceOf(DashboardError)
  })

  it('throws when the same-host session check is rejected (Origin not matching the Host)', async () => {
    dashboard = await startMockDashboard()
    // The TCP Host is the trusted loopback (undici sets it from the URL), but the
    // configured dashboard host drives a mismatched Origin → the dashboard's
    // same-host check fails and session-token returns 403.
    const client = new DashboardClient({
      hermesDashboardUrl: dashboard.url,
      hermesDashboardHost: 'evil.example.com',
    })
    await expect(client.getJson('/api/sessions')).rejects.toMatchObject({
      name: 'DashboardError',
      status: 403,
    })
  })

  it('never includes the session token in error messages', async () => {
    dashboard = await startMockDashboard()
    const client = clientFor(dashboard)
    // 404 on an unknown gated route — token is valid and cached.
    try {
      await client.getJson('/api/does-not-exist')
      throw new Error('expected throw')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).not.toContain(dashboard.lastIssuedToken)
      expect(msg).not.toMatch(/tok_/)
    }
  })
})
