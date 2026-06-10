import { describe, it, expect } from 'vitest'
import {
  CronJob,
  CronJobList,
  CronJobCreateInput,
  CronJobUpdateInput,
  CronJobStatus,
  CronScheduleKind,
} from './cron'

const BASE_JOB = {
  id: 'a1b2c3d4e5f6',
  name: 'Morning digest',
  prompt: 'Summarize my overnight emails',
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

describe('CronJob DTO', () => {
  it('parses a fully-populated cron-scheduled job', () => {
    const parsed = CronJob.parse(BASE_JOB)
    expect(parsed.schedule.kind).toBe('cron')
    expect(parsed.schedule.expr).toBe('0 9 * * 1-5')
    expect(parsed.paused).toBe(false)
    expect(parsed.lastStatus).toBe('ok')
    expect(parsed.repeatTimes).toBeNull()
  })

  it('parses an interval-scheduled, paused job with no run history', () => {
    const parsed = CronJob.parse({
      ...BASE_JOB,
      schedule: { kind: 'interval', display: 'every 30m', expr: null, minutes: 30, runAt: null },
      enabled: false,
      paused: true,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      runCount: 0,
    })
    expect(parsed.schedule.kind).toBe('interval')
    expect(parsed.schedule.minutes).toBe(30)
    expect(parsed.paused).toBe(true)
    expect(parsed.lastRunAt).toBeNull()
    expect(parsed.lastStatus).toBeNull()
  })

  it('parses a one-shot job', () => {
    const parsed = CronJob.parse({
      ...BASE_JOB,
      schedule: {
        kind: 'once',
        display: 'once at 2026-06-01 09:00',
        expr: null,
        minutes: null,
        runAt: '2026-06-01T09:00:00+00:00',
      },
      repeatTimes: 1,
    })
    expect(parsed.schedule.kind).toBe('once')
    expect(parsed.schedule.runAt).toBe('2026-06-01T09:00:00+00:00')
    expect(parsed.repeatTimes).toBe(1)
  })

  it('rejects an unknown last-status (status vocabulary is governed)', () => {
    expect(CronJobStatus.options).toEqual(['ok', 'error', 'skipped'])
    expect(() => CronJob.parse({ ...BASE_JOB, lastStatus: 'pending' })).toThrow()
  })

  it('constrains the schedule kind to the tagged-union set', () => {
    expect(CronScheduleKind.options).toEqual(['cron', 'interval', 'once'])
    expect(() =>
      CronJob.parse({
        ...BASE_JOB,
        schedule: { ...BASE_JOB.schedule, kind: 'weekly' },
      }),
    ).toThrow()
  })

  it('never carries a leaked filesystem-path field (whitelist is exhaustive)', () => {
    const parsed = CronJob.parse(BASE_JOB)
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'createdAt',
        'deliver',
        'enabled',
        'id',
        'lastError',
        'lastRunAt',
        'lastStatus',
        'name',
        'nextRunAt',
        'noAgent',
        'paused',
        'profile',
        'prompt',
        'repeatTimes',
        'runCount',
        'schedule',
      ].sort(),
    )
    for (const leak of ['hermes_home', 'workdir', 'origin', 'base_url', 'script']) {
      expect(parsed).not.toHaveProperty(leak)
    }
  })
})

describe('CronJobList DTO', () => {
  it('parses a list of jobs', () => {
    const parsed = CronJobList.parse({ jobs: [BASE_JOB] })
    expect(parsed.jobs).toHaveLength(1)
    expect(parsed.jobs[0]!.id).toBe('a1b2c3d4e5f6')
  })
})

describe('CronJobCreateInput DTO', () => {
  it('accepts a minimal prompt + schedule', () => {
    const parsed = CronJobCreateInput.parse({ prompt: 'do a thing', schedule: 'every 1h' })
    expect(parsed.prompt).toBe('do a thing')
    expect(parsed.schedule).toBe('every 1h')
  })

  it('rejects an empty prompt or schedule', () => {
    expect(() => CronJobCreateInput.parse({ prompt: '', schedule: 'every 1h' })).toThrow()
    expect(() => CronJobCreateInput.parse({ prompt: 'x', schedule: '' })).toThrow()
  })

  it('carries optional name/deliver/profile', () => {
    const parsed = CronJobCreateInput.parse({
      prompt: 'x',
      schedule: '0 9 * * *',
      name: 'Daily',
      deliver: 'telegram',
      profile: 'work',
    })
    expect(parsed.name).toBe('Daily')
    expect(parsed.deliver).toBe('telegram')
    expect(parsed.profile).toBe('work')
  })
})

describe('CronJobUpdateInput DTO', () => {
  it('accepts a partial edit (just the schedule)', () => {
    const parsed = CronJobUpdateInput.parse({ schedule: 'every 2h' })
    expect(parsed.schedule).toBe('every 2h')
    expect(parsed.prompt).toBeUndefined()
  })
})
