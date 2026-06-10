/**
 * Route-level tests for `POST /api/agent-deck/config/field` — the guarded
 * single-field config write. Uses a fake DashboardClient (injected fetchImpl)
 * so the read-modify-write round-trip can be inspected: the GET /api/config the
 * BFF reads, and the full PUT /api/config body it sends back.
 *
 * The load-bearing assertions:
 *   - an allowlisted field is written (200 { ok: true }), and the PUT body carries
 *     the patched value PLUS every untouched key (incl. secrets) verbatim;
 *   - a non-allowlisted / secret field is refused (400) WITHOUT any PUT;
 *   - an invalid value is refused (400) WITHOUT any PUT;
 *   - an upstream failure surfaces as 502 and never echoes a token.
 */
import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { registerSettingsRoutes } from './settingsRoutes'

const RAW_CONFIG = {
  model: 'anthropic/claude-sonnet-4.6',
  timezone: 'UTC',
  API_SERVER_KEY: 'sk-server-secret',
  agent: { max_turns: 90, gateway_timeout: 900 },
  auxiliary: { vision: { api_key: 'sk-vision-secret' } },
}

interface FakeDashboard {
  client: DashboardClient
  puts: Array<{ path: string; body: unknown }>
  failPut?: boolean
}

function makeFakeDashboard(opts: { failPut?: boolean } = {}): FakeDashboard {
  const puts: Array<{ path: string; body: unknown }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(input as string).pathname
    const method = init?.method ?? 'GET'
    if (path === '/') {
      return new Response(
        '<html><head><script>window.__HERMES_SESSION_TOKEN__="tok_fake";</script></head></html>',
        { headers: { 'Content-Type': 'text/html' } },
      )
    }
    if (method === 'GET' && path === '/api/config') {
      // The dashboard returns the FULL, UNREDACTED config (incl. secrets).
      return Response.json(structuredClone(RAW_CONFIG))
    }
    if (method === 'PUT' && path === '/api/config') {
      let parsed: unknown
      try {
        parsed = init?.body ? JSON.parse(init.body as string) : null
      } catch {
        parsed = null
      }
      puts.push({ path, body: parsed })
      if (opts.failPut) return new Response('boom', { status: 500 })
      return Response.json({ ok: true })
    }
    return new Response('not found', { status: 404 })
  }
  const client = new DashboardClient({
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    fetchImpl,
  })
  return { client, puts }
}

async function buildApp(client: DashboardClient): Promise<FastifyInstance> {
  const f = Fastify({ logger: false })
  await f.register(registerSettingsRoutes, { dashboard: client })
  await f.ready()
  return f
}

describe('POST /api/agent-deck/config/field', () => {
  it('writes an allowlisted scalar and round-trips every other key (incl. secrets) verbatim', async () => {
    const fake = makeFakeDashboard()
    const app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/config/field',
      payload: { key: 'timezone', value: 'America/New_York' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, key: 'timezone', value: 'America/New_York' })

    // Exactly one PUT, carrying the FULL config with the field patched and the
    // secrets carried through UNREDACTED (a redacted secret here would corrupt
    // the live credential on disk).
    expect(fake.puts).toHaveLength(1)
    const body = fake.puts[0]!.body as { config: Record<string, unknown> }
    expect(body.config.timezone).toBe('America/New_York')
    expect(body.config.API_SERVER_KEY).toBe('sk-server-secret')
    expect((body.config.auxiliary as Record<string, Record<string, unknown>>).vision!.api_key).toBe(
      'sk-vision-secret',
    )
    // The response never echoes the round-tripped secret.
    expect(res.body).not.toContain('sk-server-secret')
    expect(res.body).not.toContain('sk-vision-secret')
    await app.close()
  })

  it('patches a nested field via dot-path, preserving its siblings', async () => {
    const fake = makeFakeDashboard()
    const app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/config/field',
      payload: { key: 'agent.max_turns', value: 250 },
    })
    expect(res.statusCode).toBe(200)
    const body = fake.puts[0]!.body as { config: { agent: Record<string, unknown> } }
    expect(body.config.agent.max_turns).toBe(250)
    expect(body.config.agent.gateway_timeout).toBe(900)
    await app.close()
  })

  it('refuses a non-allowlisted / secret field with 400 and writes NOTHING', async () => {
    const fake = makeFakeDashboard()
    const app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/config/field',
      payload: { key: 'auxiliary.vision.api_key', value: 'evil' },
    })
    expect(res.statusCode).toBe(400)
    expect(fake.puts).toHaveLength(0)
    await app.close()
  })

  it('refuses an invalid value with 400 and writes NOTHING', async () => {
    const fake = makeFakeDashboard()
    const app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/config/field',
      payload: { key: 'agent.max_turns', value: -5 },
    })
    expect(res.statusCode).toBe(400)
    expect(fake.puts).toHaveLength(0)
    await app.close()
  })

  it('rejects a malformed body (missing key) with 400', async () => {
    const fake = makeFakeDashboard()
    const app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/config/field',
      payload: { value: 'x' },
    })
    expect(res.statusCode).toBe(400)
    expect(fake.puts).toHaveLength(0)
    await app.close()
  })

  it('surfaces an upstream PUT failure as 502 without echoing a token', async () => {
    const fake = makeFakeDashboard({ failPut: true })
    const app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/config/field',
      payload: { key: 'timezone', value: 'UTC' },
    })
    expect(res.statusCode).toBe(502)
    expect(res.body).not.toContain('tok_fake')
    await app.close()
  })
})
