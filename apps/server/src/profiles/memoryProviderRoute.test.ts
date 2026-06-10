import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { MemoryStatus, MemoryResetResult } from '@agent-deck/protocol'
import { DashboardError } from '../hermes/dashboardClient'
import { registerMemoryProviderRoute } from './memoryProviderRoute'

const MEMORY_STATUS = {
  active: 'mem0',
  providers: [{ name: 'mem0', description: 'Mem0 cloud memory', configured: true }],
  builtin_files: { memory: 1024, user: 0 },
}

function makeOkDashboard(
  getResult: unknown = MEMORY_STATUS,
  putResult: unknown = { ok: true, active: 'mem0' },
  postResult: unknown = { ok: true, deleted: ['MEMORY.md'] },
) {
  return {
    getJson: () => Promise.resolve(getResult),
    authedFetch: (_path: string, opts?: RequestInit) => {
      const method = opts?.method ?? 'GET'
      let result: unknown
      if (method === 'PUT') result = putResult
      else if (method === 'POST') result = postResult
      else result = getResult
      return Promise.resolve({ ok: true, json: () => Promise.resolve(result) })
    },
  } as never
}

function makeFailDashboard() {
  return {
    getJson: () => Promise.reject(new Error('connection refused')),
    authedFetch: () => Promise.reject(new Error('connection refused')),
  } as never
}

/** Hermes RESPONDED but this build does not serve the route (version skew). */
function makeRouteMissingDashboard() {
  const reject = () => Promise.reject(new DashboardError('GET /api/memory failed: HTTP 404', 404))
  return { getJson: reject, authedFetch: reject } as never
}

/** Hermes RESPONDED but the call itself FAILED (a 500, token bootstrap, etc.). */
function makeThrownHttpErrorDashboard(status: number) {
  const reject = () =>
    Promise.reject(new DashboardError(`GET /api/memory failed: HTTP ${status}`, status))
  return { getJson: reject, authedFetch: reject } as never
}

function makeHttpErrorDashboard(status: number, body: unknown) {
  return {
    getJson: () => Promise.resolve(MEMORY_STATUS),
    authedFetch: () => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) }),
  } as never
}

async function mount(dashboard: ReturnType<typeof makeOkDashboard>) {
  const app = Fastify({ logger: false })
  await registerMemoryProviderRoute(app, { dashboard })
  await app.ready()
  return app
}

describe('GET /api/agent-deck/memory-provider', () => {
  it('returns a MemoryStatus with active provider and catalog', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/memory-provider' })
    expect(res.statusCode).toBe(200)
    const body = MemoryStatus.parse(res.json())
    expect(body.active).toBe('mem0')
    expect(body.providers).toHaveLength(1)
    const firstProvider = body.providers[0]!
    expect(firstProvider.name).toBe('mem0')
    expect(firstProvider.configured).toBe(true)
    expect(body.builtin_files.memory).toBe(1024)
    await app.close()
  })

  it('returns the built-in (no external provider) state', async () => {
    const app = await mount(
      makeOkDashboard({ active: '', providers: [], builtin_files: { memory: 512, user: 256 } }),
    )
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/memory-provider' })
    expect(res.statusCode).toBe(200)
    const body = MemoryStatus.parse(res.json())
    expect(body.active).toBe('')
    expect(body.providers).toHaveLength(0)
    await app.close()
  })

  it('returns 502 "Could not reach Hermes." only on a real connection failure', async () => {
    const app = await mount(makeFailDashboard())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/memory-provider' })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({
      error: 'unavailable',
      message: 'Could not reach Hermes.',
    })
    await app.close()
  })

  it('says the build lacks the route when Hermes responds 404 (never "could not reach")', async () => {
    const app = await mount(makeRouteMissingDashboard())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/memory-provider' })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({
      error: 'unsupported',
      message:
        'Hermes responded, but this build does not support memory provider controls. Updating Hermes usually fixes this.',
    })
    await app.close()
  })

  it('treats a 2xx non-JSON SPA fallback as version skew (unsupported)', async () => {
    const reject = () =>
      Promise.reject(
        new DashboardError('GET /api/memory: this Hermes did not serve the route', 200),
      )
    const app = await mount({ getJson: reject, authedFetch: reject } as never)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/memory-provider' })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'unsupported' })
    await app.close()
  })

  it('does NOT claim "does not support" on a Hermes 500 (honest generic failure)', async () => {
    const app = await mount(makeThrownHttpErrorDashboard(500))
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/memory-provider' })
    expect(res.statusCode).toBe(502)
    const body = res.json() as { error: string; message: string }
    expect(body.error).toBe('hermes_error')
    expect(body.message).not.toContain('does not support')
    expect(body.message).toBe('Hermes had a problem answering. Check the System page or try again.')
    await app.close()
  })
})

describe('PUT /api/agent-deck/memory-provider', () => {
  it('switches the provider and returns { ok, active, restart_required: true }', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/memory-provider',
      payload: { provider: 'mem0' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean; active: string; restart_required: boolean }
    expect(body.ok).toBe(true)
    expect(body.active).toBe('mem0')
    // A provider switch always requires a gateway restart — honest, never hidden.
    expect(body.restart_required).toBe(true)
    await app.close()
  })

  it('switches to built-in (empty string)', async () => {
    const app = await mount(makeOkDashboard(MEMORY_STATUS, { ok: true, active: '' }))
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/memory-provider',
      payload: { provider: '' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean; active: string }
    expect(body.active).toBe('')
    await app.close()
  })

  it('returns 400 when provider field is missing', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/memory-provider',
      payload: { foo: 'bar' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('surfaces Hermes provider switch rejection instead of inventing success', async () => {
    const app = await mount(makeHttpErrorDashboard(409, { detail: 'Unknown memory provider' }))
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/memory-provider',
      payload: { provider: 'missing-provider' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({
      error: 'hermes_error',
      message: 'Unknown memory provider',
    })
    await app.close()
  })

  it('returns 502 when Hermes is unreachable', async () => {
    const app = await mount(makeFailDashboard())
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/memory-provider',
      payload: { provider: 'mem0' },
    })
    expect(res.statusCode).toBe(502)
    await app.close()
  })
})

describe('POST /api/agent-deck/memory-provider/reset', () => {
  it('resets all built-in files and returns what was deleted', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/memory-provider/reset',
      payload: { target: 'all' },
    })
    expect(res.statusCode).toBe(200)
    const body = MemoryResetResult.parse(res.json())
    expect(body.ok).toBe(true)
    expect(body.deleted).toContain('MEMORY.md')
    await app.close()
  })

  it('resets only the MEMORY.md file', async () => {
    const app = await mount(
      makeOkDashboard(
        MEMORY_STATUS,
        { ok: true, active: 'mem0' },
        { ok: true, deleted: ['MEMORY.md'] },
      ),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/memory-provider/reset',
      payload: { target: 'memory' },
    })
    expect(res.statusCode).toBe(200)
    const body = MemoryResetResult.parse(res.json())
    expect(body.deleted).toEqual(['MEMORY.md'])
    await app.close()
  })

  it('returns 400 when target is invalid', async () => {
    const app = await mount(makeOkDashboard())
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/memory-provider/reset',
      payload: { target: 'everything' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('surfaces Hermes reset rejection instead of inventing success', async () => {
    const app = await mount(makeHttpErrorDashboard(403, { message: 'Reset denied' }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/memory-provider/reset',
      payload: { target: 'all' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({
      error: 'hermes_error',
      message: 'Reset denied',
    })
    await app.close()
  })

  it('returns 502 when Hermes is unreachable', async () => {
    const app = await mount(makeFailDashboard())
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/memory-provider/reset',
      payload: { target: 'all' },
    })
    expect(res.statusCode).toBe(502)
    await app.close()
  })
})
