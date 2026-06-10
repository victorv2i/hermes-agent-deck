import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { StatusClient } from './statusClient'
import { startMockDashboard, type MockDashboardHandle } from './mockDashboard.test-support'
import { registerStatusRoutes } from './statusRoute'
import type { AgentDeckStatus } from '@agent-deck/protocol'

let dashboard: MockDashboardHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  await dashboard?.close()
  app = undefined
  dashboard = undefined
})

/** A representative `/api/status` payload — INCLUDING the filesystem-path fields
 * the real dashboard returns, so the leak test exercises the real risk. */
const STATUS_BODY = {
  gateway_running: true,
  gateway_state: 'running',
  gateway_platforms: {
    telegram: { state: 'connected', updated_at: 1780073401, error_code: null, error_message: null },
    cron: {
      state: 'degraded',
      updated_at: 1780073000,
      error_code: 'AUTH_EXPIRED',
      error_message: 'token expired',
    },
    cli: { state: 'stopped', updated_at: 1780072000, error_code: null, error_message: null },
  },
  active_sessions: 2,
  version: '0.15.2',
  config_version: 3,
  latest_config_version: 5,
  // SECRET-ADJACENT filesystem layout — must NEVER reach the client.
  env_path: '/home/operator/.hermes/.env',
  config_path: '/home/operator/.hermes/config.yaml',
  hermes_home: '/home/operator/.hermes',
  module_path: '/home/operator/hermes-agent/src',
  repo_path: '/home/operator/Projects/secret-repo',
} as const

async function buildAppFor(d: MockDashboardHandle): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false })
  const statusClient = new StatusClient({ hermesDashboardUrl: d.url, hermesDashboardHost: d.host })
  await fastify.register(registerStatusRoutes, { statusClient })
  await fastify.ready()
  return fastify
}

describe('GET /api/agent-deck/status', () => {
  it('maps the dashboard status into the slim cross-source DTO', async () => {
    dashboard = await startMockDashboard({ statusBody: STATUS_BODY })
    app = await buildAppFor(dashboard)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/status' })
    expect(res.statusCode).toBe(200)

    const body = res.json<AgentDeckStatus>()
    expect(body.gatewayRunning).toBe(true)
    expect(body.gatewayState).toBe('running')
    expect(body.activeSessions).toBe(2)
    expect(body.version).toBe('0.15.2')
    // config_version (3) < latest_config_version (5) → update available.
    expect(body.configUpdateAvailable).toBe(true)

    const byName = Object.fromEntries(body.platforms.map((p) => [p.name, p]))
    expect(byName.telegram).toEqual({ name: 'telegram', state: 'connected', error: null })
    expect(byName.cron).toEqual({ name: 'cron', state: 'degraded', error: 'token expired' })
    // "stopped" maps to the governed "down" state.
    expect(byName.cli!.state).toBe('down')
  })

  it('NEVER leaks any filesystem path into the DTO (security-critical)', async () => {
    dashboard = await startMockDashboard({ statusBody: STATUS_BODY })
    app = await buildAppFor(dashboard)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/status' })
    const raw = res.body

    // Neither the path KEYS nor their VALUES may appear anywhere in the response.
    for (const key of ['env_path', 'config_path', 'hermes_home', 'module_path', 'repo_path']) {
      expect(raw).not.toContain(key)
    }
    for (const value of [
      STATUS_BODY.env_path,
      STATUS_BODY.config_path,
      STATUS_BODY.hermes_home,
      STATUS_BODY.module_path,
      STATUS_BODY.repo_path,
    ]) {
      expect(raw).not.toContain(value)
    }
    // No stray leading-slash absolute path made it through at all.
    expect(raw).not.toMatch(/\/home\//)

    const body = res.json<Record<string, unknown>>()
    expect(Object.keys(body).sort()).toEqual(
      [
        'activeSessions',
        'configUpdateAvailable',
        'gatewayRunning',
        'gatewayState',
        'platforms',
        'version',
      ].sort(),
    )
  })

  it('does not flag a config update when versions match', async () => {
    dashboard = await startMockDashboard({
      statusBody: { ...STATUS_BODY, config_version: 5, latest_config_version: 5 },
    })
    app = await buildAppFor(dashboard)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/status' })
    ).json<AgentDeckStatus>()
    expect(body.configUpdateAvailable).toBe(false)
  })

  it('does not flag a config update when version fields are absent', async () => {
    dashboard = await startMockDashboard({
      statusBody: {
        gateway_running: true,
        gateway_state: 'running',
        gateway_platforms: {},
        active_sessions: 0,
        version: '0.15.2',
      },
    })
    app = await buildAppFor(dashboard)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/status' })
    ).json<AgentDeckStatus>()
    expect(body.configUpdateAvailable).toBe(false)
    expect(body.platforms).toEqual([])
  })

  it('tolerates a gateway-down payload (no platforms, not running)', async () => {
    dashboard = await startMockDashboard({
      statusBody: {
        gateway_running: false,
        gateway_state: 'stopped',
        active_sessions: 0,
        version: '0.15.2',
      },
    })
    app = await buildAppFor(dashboard)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json<AgentDeckStatus>()
    expect(body.gatewayRunning).toBe(false)
    expect(body.gatewayState).toBe('stopped')
    expect(body.platforms).toEqual([])
  })

  it('returns 502 when the dashboard is unreachable', async () => {
    const fastify = Fastify({ logger: false })
    const statusClient = new StatusClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    await fastify.register(registerStatusRoutes, { statusClient })
    await fastify.ready()
    app = fastify

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/status' })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })
})
