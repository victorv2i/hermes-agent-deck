import { describe, it, expect } from 'vitest'
import {
  humanizeDeliver,
  relativeTime,
  runsLabel,
  scheduleInWords,
  statusLabel,
  statusTone,
} from './format'
import type { CronSchedule } from './types'

describe('statusTone', () => {
  it('maps each governed status to a semantic tone (never amber)', () => {
    expect(statusTone('ok')).toBe('success')
    expect(statusTone('error')).toBe('destructive')
    expect(statusTone('skipped')).toBe('warning')
    expect(statusTone(null)).toBe('muted')
  })
})

describe('statusLabel', () => {
  it('renders a human label, including the never-run case', () => {
    expect(statusLabel('ok')).toBe('OK')
    expect(statusLabel('error')).toBe('Failed')
    expect(statusLabel('skipped')).toBe('Skipped')
    expect(statusLabel(null)).toBe('Never run')
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-05-30T12:00:00Z')

  it('returns null for null / unparseable input', () => {
    expect(relativeTime(null, now)).toBeNull()
    expect(relativeTime('not-a-date', now)).toBeNull()
  })

  it('renders "now" within the threshold', () => {
    expect(relativeTime('2026-05-30T12:00:10Z', now)).toBe('now')
  })

  it('renders future times with an "in" prefix', () => {
    expect(relativeTime('2026-05-30T12:05:00Z', now)).toBe('in 5m')
    expect(relativeTime('2026-05-30T15:00:00Z', now)).toBe('in 3h')
    expect(relativeTime('2026-06-01T12:00:00Z', now)).toBe('in 2d')
  })

  it('renders past times with an "ago" suffix', () => {
    expect(relativeTime('2026-05-30T11:55:00Z', now)).toBe('5m ago')
    expect(relativeTime('2026-05-30T09:00:00Z', now)).toBe('3h ago')
  })
})

describe('runsLabel', () => {
  it('renders an infinite-repeat count', () => {
    expect(runsLabel({ runCount: 4, repeatTimes: null })).toBe('4 runs')
    expect(runsLabel({ runCount: 1, repeatTimes: null })).toBe('1 run')
  })

  it('renders a bounded-repeat count', () => {
    expect(runsLabel({ runCount: 1, repeatTimes: 3 })).toBe('1 of 3 runs')
  })
})

describe('scheduleInWords', () => {
  const cron = (expr: string, display = expr): CronSchedule => ({
    kind: 'cron',
    display,
    expr,
    minutes: null,
    runAt: null,
  })

  it('words the common cron shapes the NL picker emits', () => {
    expect(scheduleInWords(cron('* * * * *'))).toBe('Every minute')
    expect(scheduleInWords(cron('*/15 * * * *'))).toBe('Every 15 minutes')
    expect(scheduleInWords(cron('0 * * * *'))).toBe('Every hour')
    expect(scheduleInWords(cron('0 */6 * * *'))).toBe('Every 6 hours')
    expect(scheduleInWords(cron('0 4 * * *'))).toBe('Every day at 4:00am')
    expect(scheduleInWords(cron('30 14 * * *'))).toBe('Every day at 2:30pm')
    expect(scheduleInWords(cron('0 9 * * 1-5'))).toBe('Every weekday at 9:00am')
    expect(scheduleInWords(cron('0 10 * * 0,6'))).toBe('Every weekend at 10:00am')
    expect(scheduleInWords(cron('0 18 * * 5'))).toBe('Every Friday at 6:00pm')
  })

  it('words */1 steps in the singular (never "Every 1 minutes/hours")', () => {
    expect(scheduleInWords(cron('*/1 * * * *'))).toBe('Every minute')
    expect(scheduleInWords(cron('0 */1 * * *'))).toBe('Every hour')
  })

  it('falls back to the scheduler display for shapes it cannot honestly word', () => {
    // Restricted day-of-month / month — never guessed at.
    expect(scheduleInWords(cron('0 4 1 * *'))).toBe('0 4 1 * *')
    expect(scheduleInWords(cron('5 * * * *', 'at :05 hourly'))).toBe('at :05 hourly')
  })

  it('words an interval schedule from its minutes', () => {
    const interval = (minutes: number): CronSchedule => ({
      kind: 'interval',
      display: `every ${minutes}m`,
      expr: null,
      minutes,
      runAt: null,
    })
    expect(scheduleInWords(interval(1))).toBe('Every minute')
    expect(scheduleInWords(interval(20))).toBe('Every 20 minutes')
    expect(scheduleInWords(interval(60))).toBe('Every hour')
    expect(scheduleInWords(interval(120))).toBe('Every 2 hours')
  })

  it('keeps the scheduler display for a one-shot schedule', () => {
    expect(
      scheduleInWords({
        kind: 'once',
        display: 'once at 2026-06-10 09:00',
        expr: null,
        minutes: null,
        runAt: '2026-06-10T09:00:00+00:00',
      }),
    ).toBe('once at 2026-06-10 09:00')
  })
})

describe('humanizeDeliver', () => {
  it('returns null for a local delivery (nothing to show)', () => {
    expect(humanizeDeliver('local')).toBeNull()
    expect(humanizeDeliver('')).toBeNull()
  })

  it('labels a bare platform with no raw target', () => {
    expect(humanizeDeliver('telegram')).toEqual({
      label: 'Telegram',
      target: null,
      full: 'telegram',
    })
    expect(humanizeDeliver('discord')).toEqual({ label: 'Discord', target: null, full: 'discord' })
  })

  it('labels "origin" as a friendly word, never a raw id', () => {
    expect(humanizeDeliver('origin')).toEqual({
      label: 'Where it was created',
      target: null,
      full: 'origin',
    })
  })

  it('humanizes a "platform:chat" id — platform label + short target, full preserved', () => {
    const h = humanizeDeliver('telegram:-1001234567890')
    expect(h?.label).toBe('Telegram')
    // The chat id is shortened (never the bare full id), but recoverable via `full`.
    expect(h?.target).toBe('…7890')
    expect(h?.full).toBe('telegram:-1001234567890')
  })

  it('humanizes a "platform:chat:thread" id, surfacing the thread', () => {
    const h = humanizeDeliver('telegram:-1003747177894:18975')
    expect(h?.label).toBe('Telegram')
    expect(h?.target).toBe('…7894 · thread 18975')
    expect(h?.full).toBe('telegram:-1003747177894:18975')
  })

  it('title-cases an unknown platform rather than echoing a raw token', () => {
    const h = humanizeDeliver('mattermost:room42')
    expect(h?.label).toBe('Mattermost')
    expect(h?.target).toBe('room42')
  })
})
