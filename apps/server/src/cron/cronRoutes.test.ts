import { describe, it, expect, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerCronRoutes } from './cronRoutes'
import { DashboardError } from '../hermes/dashboardClient'
import type { CronClient } from './cronClient'
import type { CronJob, CronRunList } from '@agent-deck/protocol'

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
  vi.restoreAllMocks()
})

const JOB: CronJob = {
  id: 'a1b2c3d4e5f6',
  name: 'Morning digest',
  prompt: 'Summarize overnight emails',
  schedule: {
    kind: 'cron',
    display: '0 9 * * 1-5',
    expr: '0 9 * * 1-5',
    minutes: null,
    runAt: null,
  },
  enabled: true,
  paused: false,
  profile: 'default',
  deliver: 'telegram',
  noAgent: false,
  createdAt: '2026-05-29T12:00:00+00:00',
  nextRunAt: '2026-05-30T09:00:00+00:00',
  lastRunAt: '2026-05-29T09:00:00+00:00',
  lastStatus: 'ok',
  lastError: null,
  runCount: 4,
  repeatTimes: null,
}

/** Build a Fastify instance with a (partial) fake CronClient. */
async function buildWith(client: Partial<CronClient>): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  await instance.register(registerCronRoutes, { cronClient: client as CronClient })
  await instance.ready()
  return instance
}

describe('GET /api/agent-deck/cron/jobs', () => {
  it('returns the mapped job list', async () => {
    const list = vi.fn(async () => [JOB])
    app = await buildWith({ list })

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/cron/jobs' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobs: [JOB] })
    expect(list).toHaveBeenCalledWith('all')
  })

  it('passes a ?profile filter through to the client', async () => {
    const list = vi.fn(async () => [])
    app = await buildWith({ list })
    await app.inject({ method: 'GET', url: '/api/agent-deck/cron/jobs?profile=work' })
    expect(list).toHaveBeenCalledWith('work')
  })

  it('maps an upstream failure to 502 without leaking internals', async () => {
    app = await buildWith({
      list: async () => {
        throw new DashboardError('GET /api/cron/jobs failed: HTTP 401', 401)
      },
    })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/cron/jobs' })
    expect(res.statusCode).toBe(502)
    const body = res.json() as { error: string }
    expect(body.error).toBe('Upstream dashboard error')
    expect(body.error).not.toMatch(/tok_|Bearer/)
  })
})

describe('POST /api/agent-deck/cron/jobs', () => {
  it('creates a job from a valid body', async () => {
    const create = vi.fn(async () => JOB)
    app = await buildWith({ create })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cron/jobs',
      payload: { prompt: 'do a thing', schedule: 'every 1h', name: 'Hourly' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(JOB)
    expect(create).toHaveBeenCalledWith({
      prompt: 'do a thing',
      schedule: 'every 1h',
      name: 'Hourly',
      profile: undefined,
    })
  })

  it('rejects a body missing prompt/schedule with 400 (never calls the client)', async () => {
    const create = vi.fn(async () => JOB)
    app = await buildWith({ create })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cron/jobs',
      payload: { prompt: '' },
    })

    expect(res.statusCode).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('maps an upstream 400 (bad schedule) to 400', async () => {
    app = await buildWith({
      create: async () => {
        throw new DashboardError('POST /api/cron/jobs failed: HTTP 400', 400)
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cron/jobs',
      payload: { prompt: 'x', schedule: 'nonsense' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('Invalid cron job request')
  })
})

describe('GET /api/agent-deck/cron/jobs/:id', () => {
  it('returns one job', async () => {
    const get = vi.fn(async () => JOB)
    app = await buildWith({ get })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/cron/jobs/a1b2c3d4e5f6' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(JOB)
    expect(get).toHaveBeenCalledWith('a1b2c3d4e5f6', undefined)
  })

  it('maps an upstream 404 to 404', async () => {
    app = await buildWith({
      get: async () => {
        throw new DashboardError('not found', 404)
      },
    })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/cron/jobs/missing' })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: string }).error).toBe('Job not found')
  })
})

describe('PUT /api/agent-deck/cron/jobs/:id', () => {
  it('updates a job from a valid partial body', async () => {
    const update = vi.fn(async () => JOB)
    app = await buildWith({ update })
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/cron/jobs/a1b2c3d4e5f6',
      payload: { schedule: 'every 2h' },
    })
    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith('a1b2c3d4e5f6', { schedule: 'every 2h' }, undefined)
  })
})

describe('DELETE /api/agent-deck/cron/jobs/:id', () => {
  it('deletes a job and returns { ok: true }', async () => {
    const remove = vi.fn(async () => undefined)
    app = await buildWith({ remove })
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agent-deck/cron/jobs/a1b2c3d4e5f6',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(remove).toHaveBeenCalledWith('a1b2c3d4e5f6', undefined)
  })

  it('maps an upstream 404 to 404', async () => {
    app = await buildWith({
      remove: async () => {
        throw new DashboardError('not found', 404)
      },
    })
    const res = await app.inject({ method: 'DELETE', url: '/api/agent-deck/cron/jobs/missing' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/agent-deck/cron/jobs/:id/runs', () => {
  const RUNS: CronRunList = {
    runs: [
      {
        id: 'cron_a1b2c3d4e5f6_1748520000',
        title: 'Morning digest',
        preview: 'Summarized emails',
        startedAt: '2025-05-29T08:00:00.000Z',
        endedAt: '2025-05-29T08:02:00.000Z',
        isActive: false,
        messageCount: 5,
        tokens: 1500,
        status: 'ok',
      },
    ],
    limit: 20,
  }

  it('returns the mapped run list', async () => {
    const listRuns = vi.fn(async () => RUNS)
    app = await buildWith({ listRuns })
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/cron/jobs/a1b2c3d4e5f6/runs',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(RUNS)
    expect(listRuns).toHaveBeenCalledWith('a1b2c3d4e5f6', undefined, undefined)
  })

  it('passes profile and limit through to the client', async () => {
    const listRuns = vi.fn(async () => RUNS)
    app = await buildWith({ listRuns })
    await app.inject({
      method: 'GET',
      url: '/api/agent-deck/cron/jobs/a1b2c3d4e5f6/runs?profile=work&limit=5',
    })
    expect(listRuns).toHaveBeenCalledWith('a1b2c3d4e5f6', 'work', 5)
  })

  it('maps an upstream 404 to 404', async () => {
    app = await buildWith({
      listRuns: async () => {
        throw new DashboardError('not found', 404)
      },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/cron/jobs/missing/runs',
    })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: string }).error).toBe('Job not found')
  })

  it('maps an upstream 502 without leaking internals', async () => {
    app = await buildWith({
      listRuns: async () => {
        throw new DashboardError('upstream exploded', 500)
      },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/cron/jobs/a1b2c3d4e5f6/runs',
    })
    expect(res.statusCode).toBe(502)
    expect((res.json() as { error: string }).error).toBe('Upstream dashboard error')
  })
})

describe('POST /api/agent-deck/cron/jobs/:id/{pause,resume,trigger}', () => {
  for (const verb of ['pause', 'resume', 'trigger'] as const) {
    it(`${verb} calls the client and returns the updated job`, async () => {
      const fn = vi.fn(async () => JOB)
      app = await buildWith({ [verb]: fn } as Partial<CronClient>)
      const res = await app.inject({
        method: 'POST',
        url: `/api/agent-deck/cron/jobs/a1b2c3d4e5f6/${verb}`,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(JOB)
      expect(fn).toHaveBeenCalledWith('a1b2c3d4e5f6', undefined)
    })
  }

  it('maps a missing-job trigger to 404', async () => {
    app = await buildWith({
      trigger: async () => {
        throw new DashboardError('not found', 404)
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cron/jobs/missing/trigger',
    })
    expect(res.statusCode).toBe(404)
  })
})
