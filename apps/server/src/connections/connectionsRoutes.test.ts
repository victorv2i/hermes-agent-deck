import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { registerConnectionsRoutes } from './connectionsRoutes'

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const PAIRING_BODY = {
  pending: [
    { platform: 'telegram', user_id: 'u1', user_name: 'Alice', code: 'ABCD', age_minutes: 3 },
  ],
  approved: [{ platform: 'discord', user_id: 'u2', user_name: 'Bob' }],
}

const WEBHOOKS_BODY = {
  enabled: true,
  base_url: 'https://example.com',
  subscriptions: [
    {
      name: 'gh-push',
      description: 'GitHub push',
      events: ['push'],
      deliver: 'log',
      deliver_only: false,
      prompt: '',
      skills: [],
      created_at: '2026-06-01T00:00:00Z',
      url: 'https://example.com/webhooks/gh-push',
      secret_set: true,
      enabled: true,
    },
  ],
}

const CREDENTIALS_BODY = {
  providers: [
    {
      provider: 'openai',
      entries: [
        {
          index: 1,
          id: 'abc123',
          label: 'key #1',
          auth_type: 'api_key',
          source: 'manual',
          priority: 0,
          last_status: null,
          request_count: 0,
          token_preview: 'sk-...abc4',
          has_refresh: false,
        },
      ],
    },
  ],
}

/** Make a fake fetch for the dashboard client. */
function makeFakeDashboard(opts: {
  getRoutes?: Record<string, unknown>
  postRoutes?: Record<string, unknown>
  putRoutes?: Record<string, unknown>
  deleteRoutes?: Record<string, unknown>
}) {
  const token = 'tok_test'
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (method === 'GET' && path === '/') {
      return new Response(
        `<!doctype html><script>window.__HERMES_SESSION_TOKEN__="${token}";</script>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }

    // init.headers is a Headers instance (set by DashboardClient.authedFetch).
    const hdrs = init?.headers
    const bearer =
      hdrs instanceof Headers
        ? hdrs.get('Authorization')
        : (hdrs as Record<string, string> | undefined)?.['Authorization']
    if (bearer !== `Bearer ${token}`) return json(401, { error: 'unauthorized' })

    if (method === 'GET' && opts.getRoutes && path in opts.getRoutes) {
      return json(200, opts.getRoutes[path])
    }

    if (method === 'POST' && opts.postRoutes && path in opts.postRoutes) {
      return json(200, opts.postRoutes[path])
    }

    if (method === 'PUT' && opts.putRoutes) {
      if (path in opts.putRoutes) {
        return json(200, opts.putRoutes[path])
      }
      for (const key of Object.keys(opts.putRoutes)) {
        if (path.startsWith(key)) {
          return json(200, opts.putRoutes[key])
        }
      }
    }

    if (method === 'DELETE' && opts.deleteRoutes) {
      // Try exact match first, then prefix match for parametric paths.
      if (path in opts.deleteRoutes) {
        return json(200, opts.deleteRoutes[path])
      }
      for (const key of Object.keys(opts.deleteRoutes)) {
        if (path.startsWith(key)) {
          return json(200, opts.deleteRoutes[key])
        }
      }
    }

    return json(404, { error: 'not found' })
  }
  return fetchImpl as unknown as typeof fetch
}

function buildApp(fetchImpl: typeof fetch) {
  const dashboard = new DashboardClient({
    hermesDashboardUrl: 'http://127.0.0.1:9999',
    hermesDashboardHost: '127.0.0.1:9999',
    fetchImpl,
  })
  app = Fastify()
  app.register(registerConnectionsRoutes, { dashboard })
  return app
}

// ── PAIRING ────────────────────────────────────────────────────────────────

describe('GET /api/agent-deck/pairing', () => {
  it('proxies the stock pairing response', async () => {
    const server = buildApp(makeFakeDashboard({ getRoutes: { '/api/pairing': PAIRING_BODY } }))
    const res = await server.inject({ method: 'GET', url: '/api/agent-deck/pairing' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pending).toHaveLength(1)
    expect(body.approved).toHaveLength(1)
  })

  it('returns 502 when hermes is unreachable', async () => {
    const dashboard = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 100,
    })
    app = Fastify()
    app.register(registerConnectionsRoutes, { dashboard })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/pairing' })
    expect(res.statusCode).toBe(502)
  })

  it('returns 404 { error: "unsupported" } when the pairing route is absent (version skew)', async () => {
    // No getRoutes → upstream 404. The route is absent on THIS Hermes build, NOT
    // an outage: preserve the 404 + the `unsupported` marker so the tab can show
    // an honest "not available on this Hermes version" state, not a generic error.
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({ method: 'GET', url: '/api/agent-deck/pairing' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('unsupported')
  })
})

describe('POST /api/agent-deck/pairing/approve', () => {
  it('proxies approve and returns the result', async () => {
    const server = buildApp(
      makeFakeDashboard({
        postRoutes: { '/api/pairing/approve': { ok: true, user: { user_id: 'u1' } } },
      }),
    )
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/pairing/approve',
      payload: { platform: 'telegram', code: 'ABCD' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('returns 400 when body is missing required fields', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/pairing/approve',
      payload: { platform: 'telegram' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/agent-deck/pairing/revoke', () => {
  it('proxies revoke', async () => {
    const server = buildApp(
      makeFakeDashboard({
        postRoutes: { '/api/pairing/revoke': { ok: true } },
      }),
    )
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/pairing/revoke',
      payload: { platform: 'discord', user_id: 'u2' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('returns 400 on bad body', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/pairing/revoke',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/agent-deck/pairing/clear-pending', () => {
  it('proxies clear-pending', async () => {
    const server = buildApp(
      makeFakeDashboard({
        postRoutes: { '/api/pairing/clear-pending': { ok: true, cleared: 1 } },
      }),
    )
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/pairing/clear-pending',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().cleared).toBe(1)
  })
})

// ── WEBHOOKS ───────────────────────────────────────────────────────────────

describe('GET /api/agent-deck/webhooks', () => {
  it('proxies the stock webhooks list', async () => {
    const server = buildApp(makeFakeDashboard({ getRoutes: { '/api/webhooks': WEBHOOKS_BODY } }))
    const res = await server.inject({ method: 'GET', url: '/api/agent-deck/webhooks' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.enabled).toBe(true)
    expect(body.subscriptions).toHaveLength(1)
    // Secret must NOT be present on list
    expect(body.subscriptions[0].secret).toBeUndefined()
    expect(body.subscriptions[0].secret_set).toBe(true)
  })

  it('returns 404 { error: "unsupported" } when the webhooks route is absent', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({ method: 'GET', url: '/api/agent-deck/webhooks' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('unsupported')
  })
})

describe('POST /api/agent-deck/webhooks', () => {
  it('creates a webhook and returns the one-time secret', async () => {
    const created = { ...WEBHOOKS_BODY.subscriptions[0], secret: 'abc123secrettoken' }
    const server = buildApp(
      makeFakeDashboard({
        postRoutes: { '/api/webhooks': created },
      }),
    )
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/webhooks',
      payload: { name: 'gh-push', deliver: 'log' },
    })
    expect(res.statusCode).toBe(200)
    // Secret IS present on create response (once only)
    expect(res.json().secret).toBe('abc123secrettoken')
  })

  it('returns 400 when name is missing', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/webhooks',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/agent-deck/webhooks/:name', () => {
  it('deletes a webhook', async () => {
    const server = buildApp(
      makeFakeDashboard({
        deleteRoutes: { '/api/webhooks/gh-push': { ok: true } },
      }),
    )
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/agent-deck/webhooks/gh-push',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('PUT /api/agent-deck/webhooks/:name/enabled', () => {
  it('enables a webhook', async () => {
    const server = buildApp(
      makeFakeDashboard({
        putRoutes: {
          '/api/webhooks/gh-push/enabled': { ok: true, name: 'gh-push', enabled: true },
        },
      }),
    )
    const res = await server.inject({
      method: 'PUT',
      url: '/api/agent-deck/webhooks/gh-push/enabled',
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(true)
  })

  it('returns 400 when enabled is not a boolean', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({
      method: 'PUT',
      url: '/api/agent-deck/webhooks/gh-push/enabled',
      payload: { enabled: 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── CREDENTIAL POOL ────────────────────────────────────────────────────────

describe('GET /api/agent-deck/credentials/pool', () => {
  it('returns redacted pool entries', async () => {
    const server = buildApp(
      makeFakeDashboard({ getRoutes: { '/api/credentials/pool': CREDENTIALS_BODY } }),
    )
    const res = await server.inject({ method: 'GET', url: '/api/agent-deck/credentials/pool' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.providers).toHaveLength(1)
    const entry = body.providers[0].entries[0]
    // Plaintext is never present; only token_preview
    expect(entry.token_preview).toBe('sk-...abc4')
    expect(entry.api_key).toBeUndefined()
  })

  it('returns 404 { error: "unsupported" } when the credential pool route is absent', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({ method: 'GET', url: '/api/agent-deck/credentials/pool' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('unsupported')
  })
})

describe('POST /api/agent-deck/credentials/pool', () => {
  it('adds a credential and returns count (not the key)', async () => {
    const server = buildApp(
      makeFakeDashboard({
        postRoutes: {
          '/api/credentials/pool': { ok: true, provider: 'openai', count: 2 },
        },
      }),
    )
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/credentials/pool',
      payload: { provider: 'openai', api_key: 'sk-testkey', label: 'key #2' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.count).toBe(2)
    // api_key must NEVER appear in the response
    expect(body.api_key).toBeUndefined()
  })

  it('returns 400 when provider or api_key is missing', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({
      method: 'POST',
      url: '/api/agent-deck/credentials/pool',
      payload: { provider: 'openai' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/agent-deck/credentials/pool/:provider/:index', () => {
  it('removes a pool entry by index', async () => {
    const server = buildApp(
      makeFakeDashboard({
        deleteRoutes: {
          '/api/credentials/pool/openai/1': { ok: true, provider: 'openai', count: 0 },
        },
      }),
    )
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/agent-deck/credentials/pool/openai/1',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('returns 400 for non-integer index', async () => {
    const server = buildApp(makeFakeDashboard({}))
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/agent-deck/credentials/pool/openai/abc',
    })
    expect(res.statusCode).toBe(400)
  })
})
