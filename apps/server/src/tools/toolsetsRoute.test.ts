import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { registerToolsetsRoutes } from './toolsetsRoute'

/**
 * Route-level test: a real Fastify instance with the toolsets route mounted over
 * a DashboardClient pointed at the hermetic mock dashboard. Asserts the happy
 * path shape + the 502 degradation when the dashboard is unreachable.
 */

let mock: MockDashboardHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  await mock?.close()
  mock = undefined
})

async function buildApp(dashboard: DashboardClient): Promise<FastifyInstance> {
  const instance = Fastify()
  await instance.register(registerToolsetsRoutes, { dashboard })
  await instance.ready()
  return instance
}

describe('GET /api/agent-deck/toolsets', () => {
  it('returns the slim toolsets list', async () => {
    mock = await startMockDashboard({
      routes: {
        '/api/tools/toolsets': [
          {
            name: 'file',
            label: '📁 File Operations',
            description: 'read, write, patch, search',
            enabled: true,
            available: true,
            configured: true,
            tools: ['read', 'write', 'patch', 'search'],
          },
        ],
      },
    })
    const dashboard = new DashboardClient({
      hermesDashboardUrl: mock.url,
      hermesDashboardHost: mock.host,
    })
    app = await buildApp(dashboard)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/toolsets' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { toolsets: Array<{ name: string; label: string }> }
    expect(body.toolsets).toHaveLength(1)
    expect(body.toolsets[0]!.name).toBe('file')
    expect(body.toolsets[0]!.label).toBe('File Operations')
  })

  it('degrades to 502 when the dashboard is unreachable', async () => {
    // Point the client at a closed port — no mock started.
    const dashboard = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    app = await buildApp(dashboard)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/toolsets' })
    expect(res.statusCode).toBe(502)
    expect((res.json() as { error: string }).error).toMatch(/toolsets/i)
  })
})

describe('PUT /api/agent-deck/toolsets/:name', () => {
  it('proxies the toggle to stock and returns { ok, name, enabled }', async () => {
    mock = await startMockDashboard({
      putRoutes: {
        '/api/tools/toolsets/web': { ok: true, name: 'web', enabled: true },
      },
    })
    const dashboard = new DashboardClient({
      hermesDashboardUrl: mock.url,
      hermesDashboardHost: mock.host,
    })
    app = await buildApp(dashboard)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/toolsets/web',
      payload: { enabled: true },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean; name: string; enabled: boolean }
    expect(body.ok).toBe(true)
    expect(body.name).toBe('web')
    expect(body.enabled).toBe(true)
  })

  it('returns 400 when enabled is not a boolean', async () => {
    mock = await startMockDashboard({})
    const dashboard = new DashboardClient({
      hermesDashboardUrl: mock.url,
      hermesDashboardHost: mock.host,
    })
    app = await buildApp(dashboard)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/toolsets/web',
      payload: { enabled: 'yes' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 502 when the dashboard is unreachable', async () => {
    const dashboard = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    app = await buildApp(dashboard)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/toolsets/web',
      payload: { enabled: true },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(502)
  })
})
