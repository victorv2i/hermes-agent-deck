import { describe, it, expect, vi } from 'vitest'
import { CronClient, mapCronJob } from './cronClient'
import { DashboardError } from '../hermes/dashboardClient'
import type { CronDashboard } from './cronClient'

/** A raw scheduler job dict (superset, as the dashboard returns it). */
const RAW_JOB = {
  id: 'a1b2c3d4e5f6',
  name: 'Morning digest',
  prompt: 'Summarize overnight emails',
  schedule: { kind: 'cron', expr: '0 9 * * 1-5', display: '0 9 * * 1-5' },
  schedule_display: '0 9 * * 1-5',
  enabled: true,
  state: 'scheduled',
  profile: 'default',
  deliver: 'telegram',
  no_agent: false,
  created_at: '2026-05-29T12:00:00+00:00',
  next_run_at: '2026-05-30T09:00:00+00:00',
  last_run_at: '2026-05-29T09:00:00+00:00',
  last_status: 'ok',
  last_error: null,
  repeat: { times: null, completed: 4 },
  // Filesystem-shaped fields that MUST NOT cross the boundary:
  hermes_home: '/home/operator/.hermes',
  workdir: '/home/operator/secret-project',
  origin: { chat_id: 12345 },
}

/** A fake dashboard recording the paths/inits it was asked for. */
function fakeDashboard(opts: {
  getJson?: (path: string) => Promise<unknown>
  authedFetch?: (path: string, init?: RequestInit) => Promise<Response>
}): {
  dash: CronDashboard
  getPaths: string[]
  fetchCalls: { path: string; init?: RequestInit }[]
} {
  const getPaths: string[] = []
  const fetchCalls: { path: string; init?: RequestInit }[] = []
  const dash: CronDashboard = {
    getJson: async <T>(path: string) => {
      getPaths.push(path)
      return (await (opts.getJson?.(path) ?? Promise.resolve({}))) as T
    },
    authedFetch: async (path: string, init?: RequestInit) => {
      fetchCalls.push({ path, init })
      return opts.authedFetch?.(path, init) ?? Response.json(RAW_JOB)
    },
  }
  return { dash, getPaths, fetchCalls }
}

describe('mapCronJob', () => {
  it('maps the raw scheduler dict into the slim CronJob shape', () => {
    const job = mapCronJob(RAW_JOB)
    expect(job.id).toBe('a1b2c3d4e5f6')
    expect(job.schedule).toEqual({
      kind: 'cron',
      display: '0 9 * * 1-5',
      expr: '0 9 * * 1-5',
      minutes: null,
      runAt: null,
    })
    expect(job.enabled).toBe(true)
    expect(job.paused).toBe(false)
    expect(job.lastStatus).toBe('ok')
    expect(job.runCount).toBe(4)
    expect(job.repeatTimes).toBeNull()
  })

  it('NEVER leaks filesystem-path / internal fields across the boundary', () => {
    const job = mapCronJob(RAW_JOB) as Record<string, unknown>
    for (const leak of ['hermes_home', 'workdir', 'origin', 'state', 'context_from']) {
      expect(job).not.toHaveProperty(leak)
    }
  })

  it('derives paused from enabled=false OR state=paused', () => {
    expect(mapCronJob({ ...RAW_JOB, enabled: false, state: 'scheduled' }).paused).toBe(true)
    expect(mapCronJob({ ...RAW_JOB, enabled: true, state: 'paused' }).paused).toBe(true)
    expect(mapCronJob({ ...RAW_JOB, enabled: true, state: 'scheduled' }).paused).toBe(false)
  })

  it('maps interval + once schedules', () => {
    expect(
      mapCronJob({ ...RAW_JOB, schedule: { kind: 'interval', minutes: 30, display: 'every 30m' } })
        .schedule,
    ).toEqual({ kind: 'interval', display: 'every 30m', expr: null, minutes: 30, runAt: null })
    expect(
      mapCronJob({
        ...RAW_JOB,
        schedule: { kind: 'once', run_at: '2026-06-01T09:00:00+00:00', display: 'once at …' },
      }).schedule,
    ).toEqual({
      kind: 'once',
      display: 'once at …',
      expr: null,
      minutes: null,
      runAt: '2026-06-01T09:00:00+00:00',
    })
  })

  it('coerces an unknown last_status to null and unknown kind to cron', () => {
    expect(mapCronJob({ ...RAW_JOB, last_status: 'weird' }).lastStatus).toBeNull()
    expect(
      mapCronJob({ ...RAW_JOB, schedule: { kind: 'weekly', display: 'x' } }).schedule.kind,
    ).toBe('cron')
  })

  it('defaults missing profile/deliver to safe values', () => {
    const job = mapCronJob({ id: 'x', repeat: {} })
    expect(job.profile).toBe('default')
    expect(job.deliver).toBe('local')
    expect(job.runCount).toBe(0)
  })
})

describe('CronClient.list', () => {
  it('GETs the dashboard cron list with profile=all and maps each job', async () => {
    const { dash, getPaths } = fakeDashboard({ getJson: async () => [RAW_JOB, RAW_JOB] })
    const jobs = await new CronClient(dash).list()
    expect(getPaths).toEqual(['/api/cron/jobs?profile=all'])
    expect(jobs).toHaveLength(2)
    expect(jobs[0]!.id).toBe('a1b2c3d4e5f6')
  })

  it('tolerates a non-array upstream body', async () => {
    const { dash } = fakeDashboard({ getJson: async () => ({ oops: true }) })
    expect(await new CronClient(dash).list()).toEqual([])
  })

  it('passes a specific profile through', async () => {
    const { dash, getPaths } = fakeDashboard({ getJson: async () => [] })
    await new CronClient(dash).list('work')
    expect(getPaths).toEqual(['/api/cron/jobs?profile=work'])
  })
})

describe('CronClient mutations', () => {
  it('create POSTs the dashboard CronJobCreate body', async () => {
    const { dash, fetchCalls } = fakeDashboard({})
    const job = await new CronClient(dash).create({
      prompt: 'do a thing',
      schedule: 'every 1h',
      name: 'Hourly',
      deliver: 'local',
      profile: 'work',
    })
    expect(fetchCalls[0]!.path).toBe('/api/cron/jobs?profile=work')
    expect(fetchCalls[0]!.init?.method).toBe('POST')
    expect(JSON.parse(String(fetchCalls[0]!.init?.body))).toEqual({
      prompt: 'do a thing',
      schedule: 'every 1h',
      name: 'Hourly',
      deliver: 'local',
    })
    expect(job.id).toBe('a1b2c3d4e5f6')
  })

  it('update PUTs a partial { updates } envelope', async () => {
    const { dash, fetchCalls } = fakeDashboard({})
    await new CronClient(dash).update('a1b2c3d4e5f6', { schedule: 'every 2h' })
    expect(fetchCalls[0]!.path).toBe('/api/cron/jobs/a1b2c3d4e5f6')
    expect(fetchCalls[0]!.init?.method).toBe('PUT')
    expect(JSON.parse(String(fetchCalls[0]!.init?.body))).toEqual({
      updates: { schedule: 'every 2h' },
    })
  })

  it('pause/resume/trigger POST the right action path', async () => {
    const { dash, fetchCalls } = fakeDashboard({})
    const c = new CronClient(dash)
    await c.pause('id1')
    await c.resume('id1')
    await c.trigger('id1')
    expect(fetchCalls.map((f) => f.path)).toEqual([
      '/api/cron/jobs/id1/pause',
      '/api/cron/jobs/id1/resume',
      '/api/cron/jobs/id1/trigger',
    ])
    expect(fetchCalls.every((f) => f.init?.method === 'POST')).toBe(true)
  })

  it('remove DELETEs and resolves void on 2xx', async () => {
    const { dash, fetchCalls } = fakeDashboard({
      authedFetch: async () => Response.json({ ok: true }),
    })
    await expect(new CronClient(dash).remove('id1')).resolves.toBeUndefined()
    expect(fetchCalls[0]!.path).toBe('/api/cron/jobs/id1')
    expect(fetchCalls[0]!.init?.method).toBe('DELETE')
  })

  it('surfaces a non-2xx mutation as a DashboardError carrying the status', async () => {
    const { dash } = fakeDashboard({
      authedFetch: async () => new Response('nope', { status: 404 }),
    })
    await expect(new CronClient(dash).trigger('missing')).rejects.toMatchObject({
      name: 'DashboardError',
      status: 404,
    })
  })

  it('surfaces a 400 (bad schedule) from create', async () => {
    const { dash } = fakeDashboard({
      authedFetch: async () => new Response('bad', { status: 400 }),
    })
    await expect(
      new CronClient(dash).create({ prompt: 'x', schedule: 'nonsense' }),
    ).rejects.toBeInstanceOf(DashboardError)
  })

  it('never includes the session token in the thrown error', async () => {
    const { dash } = fakeDashboard({
      authedFetch: async () => new Response('', { status: 500 }),
    })
    const err: unknown = await new CronClient(dash).pause('id1').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(DashboardError)
    expect((err as Error).message).not.toMatch(/tok_|Bearer/)
  })
})

// Defensive: a mutation response that 404s with a body still throws (not maps).
describe('CronClient.get', () => {
  it('GETs a single job by id', async () => {
    const getJson = vi.fn(async () => RAW_JOB)
    const dash: CronDashboard = {
      getJson: getJson as never,
      authedFetch: async () => Response.json(RAW_JOB),
    }
    const job = await new CronClient(dash).get('a1b2c3d4e5f6')
    expect(getJson).toHaveBeenCalledWith('/api/cron/jobs/a1b2c3d4e5f6')
    expect(job.name).toBe('Morning digest')
  })
})
