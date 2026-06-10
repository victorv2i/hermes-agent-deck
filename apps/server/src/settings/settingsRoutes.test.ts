import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { registerSettingsRoutes } from './settingsRoutes'
import { REDACTED } from './redact'
import type { SettingsPayload } from './settingsTypes'

let dashboard: MockDashboardHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  await dashboard?.close()
  app = dashboard = undefined
})

const SCHEMA = {
  category_order: ['general', 'agent', 'auxiliary'],
  fields: {
    model: { type: 'string', description: 'Default model', category: 'general' },
    'agent.max_turns': { type: 'number', description: 'Agent → Max Turns', category: 'agent' },
    'auxiliary.vision.api_key': {
      type: 'string',
      description: 'Auxiliary → Vision → Api Key',
      category: 'auxiliary',
    },
  },
}

const RAW_CONFIG = {
  model: 'anthropic/claude-sonnet-4.6',
  agent: { max_turns: 90 },
  auxiliary: { vision: { api_key: 'sk-LEAK-ME-NOT' } },
}

async function buildTestApp(d: MockDashboardHandle): Promise<FastifyInstance> {
  const f = Fastify({ logger: false })
  const client = new DashboardClient({ hermesDashboardUrl: d.url, hermesDashboardHost: d.host })
  await f.register(registerSettingsRoutes, { dashboard: client })
  await f.ready()
  return f
}

describe('GET /api/agent-deck/config', () => {
  it('returns a section-grouped, redacted config sourced from the dashboard', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/config': RAW_CONFIG, '/api/config/schema': SCHEMA },
    })
    app = await buildTestApp(dashboard)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/config' })
    expect(res.statusCode).toBe(200)
    const body = res.json<SettingsPayload>()

    expect(body.editable).toBe(false)
    const cats = body.sections.map((s) => s.category)
    expect(cats).toEqual(['general', 'agent', 'auxiliary'])

    const general = body.sections.find((s) => s.category === 'general')!
    expect(general.fields.find((f) => f.key === 'model')!.value).toBe('anthropic/claude-sonnet-4.6')
  })

  it('NEVER leaks a secret value over the wire', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/config': RAW_CONFIG, '/api/config/schema': SCHEMA },
    })
    app = await buildTestApp(dashboard)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/config' })
    expect(res.body).not.toContain('sk-LEAK-ME-NOT')

    const body = res.json<SettingsPayload>()
    const aux = body.sections.find((s) => s.category === 'auxiliary')!
    const key = aux.fields.find((f) => f.key === 'auxiliary.vision.api_key')!
    expect(key.value).toBe(REDACTED)
    expect(key.isSecret).toBe(true)
  })

  it('responds 502 when the dashboard is unreachable', async () => {
    // Point the client at a closed port so the fetch fails.
    const d = await startMockDashboard()
    const host = d.host
    const url = d.url
    await d.close() // now nothing is listening

    const f = Fastify({ logger: false })
    const client = new DashboardClient({ hermesDashboardUrl: url, hermesDashboardHost: host })
    await f.register(registerSettingsRoutes, { dashboard: client })
    await f.ready()
    app = f

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/config' })
    expect(res.statusCode).toBe(502)
    const body = res.json<{ error: string }>()
    expect(body.error).toBeTruthy()
    // error message must not look like it carries a token
    expect(JSON.stringify(body)).not.toMatch(/tok_/)
  })
})
