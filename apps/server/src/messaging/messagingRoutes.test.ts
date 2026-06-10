import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { StatusClient } from '../hermes/statusClient'
import { MessagingState, SetMessagingTokenResponse } from '@agent-deck/protocol'
import { registerMessagingRoutes } from './messagingRoutes'

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const STATUS_BODY = {
  gateway_running: true,
  gateway_state: 'running',
  gateway_platforms: {
    telegram: { state: 'connected', error_message: null },
    discord: { state: 'error', error_message: 'invalid bot token' },
    slack: { state: 'connecting', error_message: null },
  },
  // filesystem-path fields the real dashboard also returns — must never leak.
  env_path: '/home/op/.hermes/.env',
  hermes_home: '/home/op/.hermes',
}

const ENV_BODY: Record<string, unknown> = {
  TELEGRAM_BOT_TOKEN: { is_set: true, redacted_value: '12••••cd', category: 'messaging' },
  DISCORD_BOT_TOKEN: { is_set: false, redacted_value: null, category: 'messaging' },
  SLACK_BOT_TOKEN: { is_set: false, redacted_value: null, category: 'messaging' },
  SLACK_APP_TOKEN: { is_set: false, redacted_value: null, category: 'messaging' },
}

/**
 * A fake hermes dashboard as an injectable `fetch`. Drives the gated
 * DashboardClient (token bootstrap via GET / + GET/PUT /api/env) and the public
 * StatusClient (GET /api/status). `onPut` records the LAST PUT /api/env body so
 * the test can assert what (and whether) we wrote.
 */
function makeFakeDashboard(opts: {
  status?: unknown
  env?: Record<string, unknown>
  putStatus?: number
  onPut?: (body: { key: string; value: string }) => void
}): { fetchImpl: typeof fetch; puts: Array<{ key: string; value: string }> } {
  const puts: Array<{ key: string; value: string }> = []
  const env = { ...(opts.env ?? ENV_BODY) }
  const token = 'tok_test_123'

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname

    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    // Public status (no token).
    if (method === 'GET' && path === '/api/status') {
      return json(200, opts.status ?? STATUS_BODY)
    }
    // SPA root → inject the session token (DashboardClient bootstrap).
    if (method === 'GET' && path === '/') {
      return new Response(
        `<!doctype html><html><head><script>window.__HERMES_SESSION_TOKEN__="${token}";</script></head><body></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }
    if (method === 'GET' && path === '/api/env') {
      return json(200, env)
    }
    if (method === 'PUT' && path === '/api/env') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { key: string; value: string }
      puts.push(body)
      opts.onPut?.(body)
      // Model the dashboard persisting it: the next GET /api/env reflects it as
      // set with a shape-only preview (NEVER the plaintext).
      env[body.key] = { is_set: true, redacted_value: '••••set', category: 'messaging' }
      return json(opts.putStatus ?? 200, { ok: true, key: body.key })
    }
    return json(404, { error: 'not found' })
  }) as unknown as typeof fetch

  return { fetchImpl, puts }
}

async function buildTestApp(fetchImpl: typeof fetch): Promise<FastifyInstance> {
  const f = Fastify({ logger: false })
  const dashboard = new DashboardClient({
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    fetchImpl,
  })
  const statusClient = new StatusClient({
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    fetchImpl,
  })
  await f.register(registerMessagingRoutes, { dashboard, statusClient })
  await f.ready()
  return f
}

describe('GET /api/agent-deck/messaging', () => {
  it('composes registry × live status × env into MessagingState', async () => {
    const { fetchImpl } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/messaging' })
    expect(res.statusCode).toBe(200)
    const body = res.json<MessagingState>()
    expect(() => MessagingState.parse(body)).not.toThrow()
    expect(body.gatewayRunning).toBe(true)

    const byId = Object.fromEntries(body.platforms.map((p) => [p.platform.id, p]))
    expect(byId.telegram!.connection).toBe('connected')
    expect(byId.telegram!.tokens[0]!.isSet).toBe(true)
    expect(byId.discord!.connection).toBe('error')
    expect(byId.discord!.errorMessage).toBe('invalid bot token')
    expect(byId.slack!.connection).toBe('connecting')
    // status-only platforms are present too.
    expect(byId.whatsapp).toBeDefined()
  })

  it('NEVER leaks a filesystem path from the status body', async () => {
    const { fetchImpl } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/messaging' })
    expect(res.body).not.toContain('/home/op')
    expect(res.body).not.toContain('hermes_home')
    expect(res.body).not.toContain('env_path')
  })

  it('fails closed to unknown for every platform when the gateway is down', async () => {
    const { fetchImpl } = makeFakeDashboard({
      status: { gateway_running: false, gateway_state: 'stopped', gateway_platforms: {} },
    })
    app = await buildTestApp(fetchImpl)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/messaging' })
    ).json<MessagingState>()
    expect(body.gatewayRunning).toBe(false)
    for (const p of body.platforms) expect(p.connection).toBe('unknown')
  })

  it('returns 502 when the dashboard is unreachable', async () => {
    const f = Fastify({ logger: false })
    const dashboard = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 150,
    })
    const statusClient = new StatusClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 150,
    })
    await f.register(registerMessagingRoutes, { dashboard, statusClient })
    await f.ready()
    app = f
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/messaging' })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })
})

describe('POST /api/agent-deck/messaging/token', () => {
  it('stores a registry token via PUT /api/env and returns shape-only fields', async () => {
    const { fetchImpl, puts } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: {
        platform: 'discord',
        envVar: 'DISCORD_BOT_TOKEN',
        value: 'super-secret-bot-token',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<SetMessagingTokenResponse>()
    expect(() => SetMessagingTokenResponse.parse(body)).not.toThrow()
    expect(body.platform).toBe('discord')
    expect(body.restartRequired).toBe(true)
    // The refreshed field is shape-only and now set.
    const field = body.tokens.find((t) => t.envVar === 'DISCORD_BOT_TOKEN')!
    expect(field.isSet).toBe(true)
    expect(field.redactedValue).not.toContain('super-secret-bot-token')

    // We actually PUT exactly the (key, value) once.
    expect(puts).toEqual([{ key: 'DISCORD_BOT_TOKEN', value: 'super-secret-bot-token' }])
  })

  it('NEVER returns the plaintext token in the response body', async () => {
    const { fetchImpl } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)
    const secret = 'PLAINTEXT-DISCORD-TOKEN-zzz'
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'discord', envVar: 'DISCORD_BOT_TOKEN', value: secret },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain(secret)
  })

  it('REJECTS an env var that is not a registry messaging token (no arbitrary writes)', async () => {
    const { fetchImpl, puts } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'telegram', envVar: 'OPENAI_API_KEY', value: 'sk-leak' },
    })
    expect(res.statusCode).toBe(400)
    // Nothing was written upstream.
    expect(puts).toEqual([])
  })

  it('REJECTS a real messaging env var that is not a registry bot token', async () => {
    const { fetchImpl, puts } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'telegram', envVar: 'TELEGRAM_ALLOWED_USERS', value: '12345' },
    })
    expect(res.statusCode).toBe(400)
    expect(puts).toEqual([])
  })

  it('REJECTS a cross-platform pair (right var, wrong platform)', async () => {
    const { fetchImpl, puts } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'discord', envVar: 'TELEGRAM_BOT_TOKEN', value: 'x' },
    })
    expect(res.statusCode).toBe(400)
    expect(puts).toEqual([])
  })

  it('REJECTS a token write for a status-only platform', async () => {
    const { fetchImpl, puts } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'whatsapp', envVar: 'WHATSAPP_ENABLED', value: 'true' },
    })
    expect(res.statusCode).toBe(400)
    expect(puts).toEqual([])
  })

  it('400s on a malformed body (missing value)', async () => {
    const { fetchImpl, puts } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'telegram', envVar: 'TELEGRAM_BOT_TOKEN' },
    })
    expect(res.statusCode).toBe(400)
    expect(puts).toEqual([])
  })

  it('400s on an empty token value', async () => {
    const { fetchImpl, puts } = makeFakeDashboard({})
    app = await buildTestApp(fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'telegram', envVar: 'TELEGRAM_BOT_TOKEN', value: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(puts).toEqual([])
  })

  it('502s when the upstream PUT fails (never echoes internals)', async () => {
    const { fetchImpl } = makeFakeDashboard({ putStatus: 500 })
    app = await buildTestApp(fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/messaging/token',
      payload: { platform: 'telegram', envVar: 'TELEGRAM_BOT_TOKEN', value: 'tok' },
    })
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.json())).not.toMatch(/tok_/)
  })
})
