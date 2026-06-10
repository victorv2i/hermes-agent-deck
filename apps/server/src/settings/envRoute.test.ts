/**
 * Env surface BFF route tests.
 *
 * Verified stock hermes routes proxied (web_server.py):
 *   GET    /api/env  (line 1926)
 *   PUT    /api/env  (line 1945)
 *   DELETE /api/env  (line 2029)
 *
 * Security invariant: the plaintext value written via PUT must NEVER appear in
 * any response body. Tests assert on this property explicitly.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { registerEnvRoutes } from './envRoute'

/* ─── tiny mock ─── */
interface MockHandle {
  url: string
  host: string
  lastPutBody: { key: string; value: string } | undefined
  lastDeleteBody: { key: string } | undefined
  close(): Promise<void>
}

const MOCK_ENV: Record<string, unknown> = {
  OPENROUTER_API_KEY: {
    is_set: true,
    redacted_value: 'sk-or-...abc4',
    description: 'OpenRouter API key',
    url: 'https://openrouter.ai',
    category: 'provider',
    is_password: true,
    tools: [],
    advanced: false,
  },
  TELEGRAM_BOT_TOKEN: {
    is_set: false,
    redacted_value: null,
    description: 'Telegram bot token',
    url: null,
    category: 'messaging',
    is_password: true,
    tools: [],
    advanced: false,
  },
}

async function startMock(
  opts: {
    putFails?: boolean
    deleteFails?: boolean
    deleteNotFound?: boolean
  } = {},
): Promise<MockHandle> {
  let lastPutBody: { key: string; value: string } | undefined
  let lastDeleteBody: { key: string } | undefined
  let activeToken: string | undefined

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const host = req.headers['host'] ?? ''
    const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined
    const auth = req.headers['authorization']

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    const hostname = host.split(':')[0]
    const sessionOk =
      hostname === '127.0.0.1' &&
      origin !== undefined &&
      (() => {
        try {
          return new URL(origin).host.toLowerCase() === host.toLowerCase()
        } catch {
          return false
        }
      })()

    if (req.method === 'GET' && path === '/') {
      if (!sessionOk) return json(403, { error: 'forbidden' })
      activeToken = `tok_${randomUUID()}`
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<html><head><script>window.__HERMES_SESSION_TOKEN__="${activeToken}";</script></head></html>`,
      )
      return
    }

    if (auth !== `Bearer ${activeToken}` || activeToken === undefined) {
      return json(401, { error: 'unauthorized' })
    }

    if (req.method === 'GET' && path === '/api/env') {
      return json(200, MOCK_ENV)
    }

    if (req.method === 'PUT' && path === '/api/env') {
      if (opts.putFails) return json(400, { detail: 'invalid key name' })
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        lastPutBody = JSON.parse(raw) as { key: string; value: string }
        json(200, { ok: true, key: lastPutBody.key })
      })
      return
    }

    if (req.method === 'DELETE' && path === '/api/env') {
      if (opts.deleteNotFound) return json(404, { detail: 'key not found' })
      if (opts.deleteFails) return json(500, { error: 'boom' })
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        lastDeleteBody = JSON.parse(raw) as { key: string }
        json(200, { ok: true, key: lastDeleteBody.key })
      })
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
    get lastPutBody() {
      return lastPutBody
    },
    get lastDeleteBody() {
      return lastDeleteBody
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        server.closeAllConnections?.()
      }),
  }
}

let mock: MockHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  await mock?.close()
  app = undefined
  mock = undefined
})

async function buildApp(m: MockHandle): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false })
  const client = new DashboardClient({ hermesDashboardUrl: m.url, hermesDashboardHost: m.host })
  await fastify.register(registerEnvRoutes, { dashboard: client })
  await fastify.ready()
  return fastify
}

describe('GET /api/agent-deck/env', () => {
  it('returns the redacted env map from hermes', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/env' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{
      env: Record<string, { is_set: boolean; redacted_value: string | null }>
    }>()
    expect(body.env).toBeDefined()
    expect(body.env['OPENROUTER_API_KEY']!.is_set).toBe(true)
    expect(body.env['OPENROUTER_API_KEY']!.redacted_value).toBe('sk-or-...abc4')
    // plaintext never in response
    expect(res.body).not.toMatch(/sk-or-[a-zA-Z0-9]{20,}/)
  })

  it('returns 502 when hermes is unreachable', async () => {
    const fastify = Fastify({ logger: false })
    const client = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    await fastify.register(registerEnvRoutes, { dashboard: client })
    await fastify.ready()
    app = fastify
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/env' })
    expect(res.statusCode).toBe(502)
  })
})

describe('PUT /api/agent-deck/env', () => {
  it('proxies the key/value to hermes and returns ok + restartRequired', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/env',
      payload: { key: 'OPENROUTER_API_KEY', value: 'sk-or-realvalue12345' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; key: string; restartRequired: boolean }>()
    expect(body.ok).toBe(true)
    expect(body.key).toBe('OPENROUTER_API_KEY')
    expect(body.restartRequired).toBe(true)
    // The plaintext value must NEVER appear in the response.
    expect(res.body).not.toContain('realvalue12345')
    // But it was forwarded to hermes.
    expect(mock.lastPutBody?.key).toBe('OPENROUTER_API_KEY')
    expect(mock.lastPutBody?.value).toBe('sk-or-realvalue12345')
  })

  it('400s when key is missing', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/env',
      payload: { value: 'sk-xyz' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400s when value is empty', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/env',
      payload: { key: 'OPENROUTER_API_KEY', value: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('surfaces hermes 400 (invalid key) as 400', async () => {
    mock = await startMock({ putFails: true })
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/env',
      payload: { key: 'BAD_KEY', value: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('never echoes the plaintext value in any error response', async () => {
    mock = await startMock({ putFails: true })
    app = await buildApp(mock)
    const plaintext = 'super-secret-key-9876'
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/env',
      payload: { key: 'BAD_KEY', value: plaintext },
    })
    expect(res.body).not.toContain(plaintext)
  })
})

describe('DELETE /api/agent-deck/env', () => {
  it('proxies the key deletion to hermes and returns ok + restartRequired', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agent-deck/env',
      payload: { key: 'OPENROUTER_API_KEY' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; key: string; restartRequired: boolean }>()
    expect(body.ok).toBe(true)
    expect(body.restartRequired).toBe(true)
    expect(mock.lastDeleteBody?.key).toBe('OPENROUTER_API_KEY')
  })

  it('400s when key is missing', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({ method: 'DELETE', url: '/api/agent-deck/env', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('404s when hermes says key not found', async () => {
    mock = await startMock({ deleteNotFound: true })
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agent-deck/env',
      payload: { key: 'MISSING_KEY' },
    })
    expect(res.statusCode).toBe(404)
  })
})
