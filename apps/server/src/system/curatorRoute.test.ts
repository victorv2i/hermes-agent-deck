import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { CuratorStatus } from '@agent-deck/protocol'
import { registerCuratorRoute } from './curatorRoute'

const CURATOR_RESPONSE = {
  enabled: true,
  paused: false,
  interval_hours: 24,
  last_run_at: '2026-06-01T12:00:00Z',
  min_idle_hours: 1,
  stale_after_days: 7,
  archive_after_days: 30,
}

function makeOkDashboard(getResult: unknown = CURATOR_RESPONSE) {
  return {
    getJson: () => Promise.resolve(getResult),
    authedFetch: (_path: string, opts?: RequestInit) => {
      const body = opts?.body ? JSON.parse(opts.body as string) : {}
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, ...body }),
      })
    },
  } as never
}

function makeFailDashboard() {
  return {
    getJson: () => Promise.reject(new Error('Hermes 500 curator unavailable')),
    authedFetch: () => Promise.reject(new Error('network error')),
  } as never
}

async function mount(dashboard: ReturnType<typeof makeOkDashboard>) {
  const app = Fastify({ logger: false })
  await registerCuratorRoute(app, { dashboard })
  await app.ready()
  return app
}

describe('GET /api/agent-deck/curator', () => {
  it('returns a CuratorStatus with available=true when the curator module is present', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/curator' })
    expect(res.statusCode).toBe(200)
    const body = CuratorStatus.parse(res.json())
    expect(body.available).toBe(true)
    expect(body.enabled).toBe(true)
    expect(body.paused).toBe(false)
    expect(body.interval_hours).toBe(24)
    await app.close()
  })

  it('returns available=false (honest unavailable) when Hermes 500s / module absent', async () => {
    const app = await mount(makeFailDashboard())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/curator' })
    expect(res.statusCode).toBe(200)
    const body = CuratorStatus.parse(res.json())
    expect(body.available).toBe(false)
    expect(body.enabled).toBe(false)
    expect(body.interval_hours).toBeNull()
    await app.close()
  })
})

describe('PUT /api/agent-deck/curator/paused', () => {
  it('pauses the curator and returns { ok, paused: true }', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/curator/paused',
      payload: { paused: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean; paused: boolean }
    expect(body.ok).toBe(true)
    expect(body.paused).toBe(true)
    await app.close()
  })

  it('returns 400 when paused is not a boolean', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/curator/paused',
      payload: { paused: 'yes' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 502 when Hermes is unreachable', async () => {
    const app = await mount(makeFailDashboard())
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/curator/paused',
      payload: { paused: false },
    })
    expect(res.statusCode).toBe(502)
    await app.close()
  })
})

describe('POST /api/agent-deck/curator/run', () => {
  it('returns { ok: true } when the run is queued', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/curator/run' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { ok: boolean }).ok).toBe(true)
    await app.close()
  })

  it('returns 502 when Hermes is unreachable', async () => {
    const app = await mount(makeFailDashboard())
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/curator/run' })
    expect(res.statusCode).toBe(502)
    await app.close()
  })
})
