import { describe, it, expect } from 'vitest'
import { parseNlSchedule, nextRuns } from './nlSchedule'

/**
 * The parser is a PURE phrase → 5-field-cron mapper. These tests are the contract:
 * a known phrase → its exact cron; an unknown phrase → null (the UI then falls back
 * to the raw cron field rather than guessing). Whitespace + case are not significant.
 */
describe('parseNlSchedule — daily', () => {
  it('"every day" → midnight daily', () => {
    expect(parseNlSchedule('every day')?.cron).toBe('0 0 * * *')
  })
  it('"daily" is an alias for every day', () => {
    expect(parseNlSchedule('daily')?.cron).toBe('0 0 * * *')
  })
  it('"every morning" → 8am daily', () => {
    expect(parseNlSchedule('every morning')?.cron).toBe('0 8 * * *')
  })
  it('"every evening" → 6pm daily', () => {
    expect(parseNlSchedule('every evening')?.cron).toBe('0 18 * * *')
  })
  it('"every night" → 9pm daily', () => {
    expect(parseNlSchedule('every night')?.cron).toBe('0 21 * * *')
  })
  it('"every day at 8" → 8am daily', () => {
    expect(parseNlSchedule('every day at 8')?.cron).toBe('0 8 * * *')
  })
  it('"every morning at 8" → 8am daily', () => {
    expect(parseNlSchedule('every morning at 8')?.cron).toBe('0 8 * * *')
  })
  it('"every day at 9am" → 9am daily', () => {
    expect(parseNlSchedule('every day at 9am')?.cron).toBe('0 9 * * *')
  })
  it('"every day at 9pm" → 21:00 daily', () => {
    expect(parseNlSchedule('every day at 9pm')?.cron).toBe('0 21 * * *')
  })
  it('"at 9am" (bare time) → 9am daily', () => {
    expect(parseNlSchedule('at 9am')?.cron).toBe('0 9 * * *')
  })
  it('"every day at 9:30am" → minute respected', () => {
    expect(parseNlSchedule('every day at 9:30am')?.cron).toBe('30 9 * * *')
  })
  it('"every day at 14:45" (24h) → 45 14 * * *', () => {
    expect(parseNlSchedule('every day at 14:45')?.cron).toBe('45 14 * * *')
  })
  it('"every day at 12am" → midnight (0)', () => {
    expect(parseNlSchedule('every day at 12am')?.cron).toBe('0 0 * * *')
  })
  it('"every day at 12pm" → noon (12)', () => {
    expect(parseNlSchedule('every day at 12pm')?.cron).toBe('0 12 * * *')
  })
  it('"every day at noon" → 12:00', () => {
    expect(parseNlSchedule('every day at noon')?.cron).toBe('0 12 * * *')
  })
  it('"every day at midnight" → 0:00', () => {
    expect(parseNlSchedule('every day at midnight')?.cron).toBe('0 0 * * *')
  })
})

describe('parseNlSchedule — hourly / minute intervals', () => {
  it('"every hour" / "hourly" → top of every hour', () => {
    expect(parseNlSchedule('every hour')?.cron).toBe('0 * * * *')
    expect(parseNlSchedule('hourly')?.cron).toBe('0 * * * *')
  })
  it('"every 3 hours" → 0 */3 * * *', () => {
    expect(parseNlSchedule('every 3 hours')?.cron).toBe('0 */3 * * *')
  })
  it('"every 2 hours" with singular spelling still parses', () => {
    expect(parseNlSchedule('every 2 hour')?.cron).toBe('0 */2 * * *')
  })
  it('"every 15 minutes" → */15 * * * *', () => {
    expect(parseNlSchedule('every 15 minutes')?.cron).toBe('*/15 * * * *')
  })
  it('"every minute" → * * * * *', () => {
    expect(parseNlSchedule('every minute')?.cron).toBe('* * * * *')
  })
  it('rejects "every 0 hours" / nonsense step (returns null)', () => {
    expect(parseNlSchedule('every 0 hours')).toBeNull()
  })
  it('rejects a step that does not divide into range (every 25 hours)', () => {
    expect(parseNlSchedule('every 25 hours')).toBeNull()
  })
})

describe('parseNlSchedule — weekdays / weekly', () => {
  it('"every weekday" → Mon–Fri at midnight', () => {
    expect(parseNlSchedule('every weekday')?.cron).toBe('0 0 * * 1-5')
  })
  it('"weekdays at 9am" → 0 9 * * 1-5', () => {
    expect(parseNlSchedule('weekdays at 9am')?.cron).toBe('0 9 * * 1-5')
  })
  it('"every weekday at 9am" → 0 9 * * 1-5', () => {
    expect(parseNlSchedule('every weekday at 9am')?.cron).toBe('0 9 * * 1-5')
  })
  it('"every weekend" → Sat+Sun', () => {
    expect(parseNlSchedule('every weekend')?.cron).toBe('0 0 * * 0,6')
  })
  it('"weekly on monday" → 0 0 * * 1', () => {
    expect(parseNlSchedule('weekly on monday')?.cron).toBe('0 0 * * 1')
  })
  it('"every monday at 9am" → 0 9 * * 1', () => {
    expect(parseNlSchedule('every monday at 9am')?.cron).toBe('0 9 * * 1')
  })
  it('"every sunday" → 0 0 * * 0', () => {
    expect(parseNlSchedule('every sunday')?.cron).toBe('0 0 * * 0')
  })
  it('day abbreviations work ("every fri at 5pm")', () => {
    expect(parseNlSchedule('every fri at 5pm')?.cron).toBe('0 17 * * 5')
  })
})

describe('parseNlSchedule — robustness', () => {
  it('is case-insensitive and trims', () => {
    expect(parseNlSchedule('  EVERY Morning  ')?.cron).toBe('0 8 * * *')
  })
  it('returns null for an empty / blank phrase', () => {
    expect(parseNlSchedule('')).toBeNull()
    expect(parseNlSchedule('   ')).toBeNull()
  })
  it('returns null for an unparseable phrase (no silent guess)', () => {
    expect(parseNlSchedule('whenever I feel like it')).toBeNull()
    expect(parseNlSchedule('the third blue moon')).toBeNull()
  })
  it('returns null for a bad clock time (25:00)', () => {
    expect(parseNlSchedule('every day at 25:00')).toBeNull()
  })
  it('returns null for an out-of-range 12h hour (13pm)', () => {
    expect(parseNlSchedule('every day at 13pm')).toBeNull()
  })
  it('exposes a human label alongside the cron', () => {
    const r = parseNlSchedule('every morning at 8')
    expect(r?.cron).toBe('0 8 * * *')
    expect(r?.label.toLowerCase()).toContain('8')
  })
})

describe('nextRuns — honest preview', () => {
  // A fixed Monday for determinism: 2026-06-01T07:00:00 local.
  const monday = new Date(2026, 5, 1, 7, 0, 0)

  it('lists the next N fire times for a daily cron', () => {
    const runs = nextRuns('0 8 * * *', { from: monday, count: 3 })
    expect(runs).toHaveLength(3)
    // First run is 8am the same Monday (07:00 < 08:00).
    expect(runs[0]!.getHours()).toBe(8)
    expect(runs[0]!.getDate()).toBe(1)
    expect(runs[1]!.getDate()).toBe(2)
    expect(runs[2]!.getDate()).toBe(3)
  })

  it('rolls to tomorrow when today’s time already passed', () => {
    const afternoon = new Date(2026, 5, 1, 12, 0, 0)
    const runs = nextRuns('0 8 * * *', { from: afternoon, count: 1 })
    expect(runs[0]!.getDate()).toBe(2)
    expect(runs[0]!.getHours()).toBe(8)
  })

  it('respects a weekday-restricted cron (skips the weekend)', () => {
    // 2026-06-05 is a Friday; next weekday run after Fri 9am is Mon 2026-06-08.
    const friAfter = new Date(2026, 5, 5, 10, 0, 0)
    const runs = nextRuns('0 9 * * 1-5', { from: friAfter, count: 1 })
    expect(runs[0]!.getDate()).toBe(8)
    expect(runs[0]!.getDay()).toBe(1) // Monday
  })

  it('handles step hours (every 3 hours)', () => {
    const runs = nextRuns('0 */3 * * *', { from: new Date(2026, 5, 1, 7, 30, 0), count: 2 })
    expect(runs[0]!.getHours()).toBe(9)
    expect(runs[1]!.getHours()).toBe(12)
  })

  it('returns [] for an invalid cron rather than throwing', () => {
    expect(nextRuns('not a cron', { from: monday, count: 3 })).toEqual([])
    expect(nextRuns('0 8 * *', { from: monday, count: 3 })).toEqual([])
  })
})
