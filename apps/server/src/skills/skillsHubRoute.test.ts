/**
 * Skills Hub BFF route tests.
 *
 * Verified stock hermes routes called by the BFF (web_server.py):
 *   GET  /api/skills/hub/search   (line 5390)
 *   POST /api/skills/hub/install  (line 5350)
 *   POST /api/skills/hub/uninstall (line 5367)
 *   POST /api/skills/hub/update   (line 5380)
 *   GET  /api/actions/{name}/status (line 1330)
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { registerSkillsHubRoutes } from './skillsHubRoute'

/* ─── tiny loopback mock of the hermes dashboard hub endpoints ─── */
interface MockHandle {
  url: string
  host: string
  lastInstall: string | undefined
  lastUninstall: string | undefined
  updateCalled: boolean
  close(): Promise<void>
}

async function startMock(
  opts: {
    failSearch?: boolean
    failInstall?: boolean
    actionRunning?: boolean
  } = {},
): Promise<MockHandle> {
  let lastInstall: string | undefined
  let lastUninstall: string | undefined
  let updateCalled = false
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

    // Token bootstrap via GET /
    if (req.method === 'GET' && path === '/') {
      if (!sessionOk) return json(403, { error: 'forbidden' })
      activeToken = `tok_${randomUUID()}`
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<html><head><script>window.__HERMES_SESSION_TOKEN__="${activeToken}";</script></head></html>`,
      )
      return
    }

    // Auth check for all other endpoints
    if (auth !== `Bearer ${activeToken}` || activeToken === undefined) {
      return json(401, { error: 'unauthorized' })
    }

    // Hub search (GET /api/skills/hub/search)
    if (req.method === 'GET' && path === '/api/skills/hub/search') {
      if (opts.failSearch) return json(502, { error: 'upstream down' })
      const q = url.searchParams.get('q') ?? ''
      if (!q) return json(200, { results: [] })
      return json(200, {
        results: [
          {
            name: 'axolotl',
            description: 'Fine-tune models',
            source: 'nous',
            identifier: 'nous/axolotl',
            trust_level: 'official',
            repo: 'https://github.com/NousResearch/axolotl',
            tags: ['mlops', 'training'],
          },
        ],
      })
    }

    // Hub install (POST /api/skills/hub/install)
    if (req.method === 'POST' && path === '/api/skills/hub/install') {
      if (opts.failInstall) return json(500, { error: 'spawn failed' })
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = JSON.parse(raw) as { identifier?: string }
        lastInstall = body.identifier
        json(200, { ok: true, pid: 1234, name: 'skills-install' })
      })
      return
    }

    // Hub uninstall (POST /api/skills/hub/uninstall)
    if (req.method === 'POST' && path === '/api/skills/hub/uninstall') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = JSON.parse(raw) as { name?: string }
        lastUninstall = body.name
        json(200, { ok: true, pid: 5678, name: 'skills-uninstall' })
      })
      return
    }

    // Hub update (POST /api/skills/hub/update)
    if (req.method === 'POST' && path === '/api/skills/hub/update') {
      updateCalled = true
      json(200, { ok: true, pid: 9999, name: 'skills-update' })
      return
    }

    // Action status (GET /api/actions/{name}/status)
    if (req.method === 'GET' && path.startsWith('/api/actions/') && path.endsWith('/status')) {
      json(200, {
        name: 'skills-install',
        running: opts.actionRunning ?? false,
        exit_code: opts.actionRunning ? null : 0,
        pid: 1234,
        lines: ['Installing axolotl...', 'Done.'],
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
    get lastInstall() {
      return lastInstall
    },
    get lastUninstall() {
      return lastUninstall
    },
    get updateCalled() {
      return updateCalled
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
  await fastify.register(registerSkillsHubRoutes, { dashboard: client })
  await fastify.ready()
  return fastify
}

describe('GET /api/agent-deck/skills/hub/search', () => {
  it('returns results for a non-empty query', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/skills/hub/search?q=axolotl',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ results: { name: string }[] }>()
    expect(body.results).toHaveLength(1)
    expect(body.results[0]!.name).toBe('axolotl')
  })

  it('returns empty results for an empty query', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/skills/hub/search?q=' })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ results: unknown[] }>().results).toHaveLength(0)
  })

  it('returns 502 when dashboard search fails', async () => {
    mock = await startMock({ failSearch: true })
    app = await buildApp(mock)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/skills/hub/search?q=x' })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })
})

describe('POST /api/agent-deck/skills/hub/install', () => {
  it('forwards the identifier and returns action + restartRequired', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/skills/hub/install',
      payload: { identifier: 'nous/axolotl' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; action: string; restartRequired: boolean }>()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('skills-install')
    expect(body.restartRequired).toBe(true)
    expect(mock.lastInstall).toBe('nous/axolotl')
  })

  it('400s when identifier is missing', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/skills/hub/install',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('502s when the dashboard spawn fails', async () => {
    mock = await startMock({ failInstall: true })
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/skills/hub/install',
      payload: { identifier: 'x' },
    })
    expect(res.statusCode).toBe(502)
  })
})

describe('POST /api/agent-deck/skills/hub/uninstall', () => {
  it('forwards the name and returns action + restartRequired', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/skills/hub/uninstall',
      payload: { name: 'axolotl' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; action: string; restartRequired: boolean }>()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('skills-uninstall')
    expect(body.restartRequired).toBe(true)
    expect(mock.lastUninstall).toBe('axolotl')
  })

  it('400s when name is missing', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/skills/hub/uninstall',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/agent-deck/skills/hub/update', () => {
  it('triggers the update and returns action + restartRequired false', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/skills/hub/update',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; action: string; restartRequired: boolean }>()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('skills-update')
    expect(body.restartRequired).toBe(false)
    expect(mock.updateCalled).toBe(true)
  })
})

describe('GET /api/agent-deck/skills/hub/action-status', () => {
  it('polls the action status', async () => {
    mock = await startMock({ actionRunning: true })
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/skills/hub/action-status?name=skills-install',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ running: boolean; exit_code: null; lines: string[] }>()
    expect(body.running).toBe(true)
    expect(body.exit_code).toBeNull()
    expect(Array.isArray(body.lines)).toBe(true)
  })

  it('400s for an invalid action name', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/skills/hub/action-status?name=invalid-action',
    })
    expect(res.statusCode).toBe(400)
  })
})
