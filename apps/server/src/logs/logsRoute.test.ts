import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { LogsClient } from './logsClient'
import { registerLogsRoutes } from './logsRoute'
import type { AgentDeckLogs } from '@agent-deck/protocol'

let dashboard: MockDashboardHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  await dashboard?.close()
  app = undefined
  dashboard = undefined
})

const AGENT_LINES = [
  '2026-05-30 22:35:00,123 INFO hermes.gateway started on :8643',
  '2026-05-30 22:35:01,002 WARNING hermes.cron token nearing expiry',
  '2026-05-30 22:35:02,500 ERROR hermes.agent failed to dispatch',
]

async function buildAppFor(d: MockDashboardHandle): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false })
  const dashboardClient = new DashboardClient({
    hermesDashboardUrl: d.url,
    hermesDashboardHost: d.host,
  })
  const logsClient = new LogsClient(dashboardClient)
  await fastify.register(registerLogsRoutes, { logsClient })
  await fastify.ready()
  return fastify
}

describe('GET /api/agent-deck/logs', () => {
  it('proxies the gated dashboard logs and returns the structured DTO', async () => {
    dashboard = await startMockDashboard({
      // The mock matches gated routes by PATHNAME (query string is stripped); the
      // client unit tests assert the exact query string. Here we verify the route
      // wiring + token dance end-to-end.
      routes: { '/api/logs': { file: 'agent', lines: AGENT_LINES } },
    })
    app = await buildAppFor(dashboard)

    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/logs?file=agent&lines=100',
    })
    expect(res.statusCode).toBe(200)

    const body = res.json<AgentDeckLogs>()
    expect(body.file).toBe('agent')
    expect(body.entries).toHaveLength(3)
    expect(body.entries[0]!.level).toBe('INFO')
    expect(body.entries[1]!.level).toBe('WARNING')
    expect(body.entries[2]!.level).toBe('ERROR')
    expect(body.entries[0]!.logger).toBe('hermes.gateway')
  })

  it('went through the gated token dance (Authorization seen by the dashboard)', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/logs': { file: 'agent', lines: [] } },
    })
    app = await buildAppFor(dashboard)
    await app.inject({ method: 'GET', url: '/api/agent-deck/logs?file=agent&lines=100' })

    // A session token was fetched and the logs call carried a Bearer.
    expect(dashboard.tokenFetchCount).toBeGreaterThanOrEqual(1)
    const logsCall = dashboard.calls.find((c) => c.path === '/api/logs' && c.method === 'GET')
    expect(logsCall?.authorization).toMatch(/^Bearer /)
  })

  it('defaults file to agent and lines to 100 when omitted', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/logs': { file: 'agent', lines: AGENT_LINES } },
    })
    app = await buildAppFor(dashboard)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/logs' })
    expect(res.statusCode).toBe(200)
    expect(res.json<AgentDeckLogs>().entries).toHaveLength(3)
  })

  it('forwards level + search as query params to the dashboard', async () => {
    dashboard = await startMockDashboard({
      routes: {
        '/api/logs': {
          file: 'gateway',
          lines: ['2026-05-30 22:35:02,500 ERROR hermes.agent failed to dispatch'],
        },
      },
    })
    app = await buildAppFor(dashboard)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/logs?file=gateway&lines=50&level=ERROR&search=dispatch',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<AgentDeckLogs>().entries).toHaveLength(1)
  })

  it('rejects an unknown file with a 400 (never reaches the dashboard)', async () => {
    dashboard = await startMockDashboard({ routes: {} })
    app = await buildAppFor(dashboard)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/logs?file=/etc/passwd' })
    expect(res.statusCode).toBe(400)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
    // The dashboard was never asked for logs.
    expect(dashboard.calls.some((c) => c.path === '/api/logs')).toBe(false)
  })

  it('returns 502 when the dashboard is unreachable', async () => {
    const fastify = Fastify({ logger: false })
    const dashboardClient = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    await fastify.register(registerLogsRoutes, { logsClient: new LogsClient(dashboardClient) })
    await fastify.ready()
    app = fastify

    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/logs?file=agent&lines=100',
    })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })
})
