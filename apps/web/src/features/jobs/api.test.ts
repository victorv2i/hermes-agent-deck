import { describe, it, expect, vi, afterEach } from 'vitest'
import { createJob, deleteJob, fetchJobs, jobAction, updateJob } from './api'
import type { CronJob } from './types'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

describe('fetchJobs', () => {
  it('GETs the BFF cron list and returns the jobs array', async () => {
    const fetchMock = vi.fn(async () => Response.json({ jobs: [JOB] }))
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await fetchJobs()
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-deck/cron/jobs', {
      signal: undefined,
      headers: { Accept: 'application/json' },
    })
    expect(jobs).toEqual([JOB])
  })

  it('tolerates a missing jobs field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({})),
    )
    expect(await fetchJobs()).toEqual([])
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    )
    await expect(fetchJobs()).rejects.toThrow(/502/)
  })
})

describe('createJob', () => {
  it('POSTs the create body as JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(JOB))
    vi.stubGlobal('fetch', fetchMock)

    await createJob({ prompt: 'x', schedule: 'every 1h', name: 'Hourly' })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/cron/jobs')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'x',
      schedule: 'every 1h',
      name: 'Hourly',
    })
  })
})

describe('updateJob', () => {
  it('PUTs a partial edit body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(JOB))
    vi.stubGlobal('fetch', fetchMock)

    await updateJob('a1b2c3d4e5f6', { schedule: 'every 2h' })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/cron/jobs/a1b2c3d4e5f6')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ schedule: 'every 2h' })
  })
})

describe('jobAction', () => {
  it.each(['pause', 'resume', 'trigger'] as const)('POSTs the %s action', async (verb) => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(JOB))
    vi.stubGlobal('fetch', fetchMock)

    await jobAction('a1b2c3d4e5f6', verb)
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe(`/api/agent-deck/cron/jobs/a1b2c3d4e5f6/${verb}`)
    expect(init.method).toBe('POST')
  })
})

describe('deleteJob', () => {
  it('DELETEs the job', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await deleteJob('a1b2c3d4e5f6')
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/cron/jobs/a1b2c3d4e5f6')
    expect(init.method).toBe('DELETE')
    expect(out).toEqual({ ok: true })
  })
})
