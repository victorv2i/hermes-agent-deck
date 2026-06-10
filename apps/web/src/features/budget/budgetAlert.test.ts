import { describe, it, expect } from 'vitest'
import { detectBreaches, pickUnwarnedBreaches, usageWindowDays } from './budgetAlert'
import type { Budget } from './budgetStore'
import type { UsageDailyPoint } from '@/features/usage/types'

function day(over: Partial<UsageDailyPoint> & { day: string }): UsageDailyPoint {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    estimatedCost: 0,
    actualCost: 0,
    sessions: 0,
    ...over,
  }
}

const now = new Date('2026-05-31T10:00:00Z')

describe('detectBreaches', () => {
  it('flags a daily breach when today exceeds the daily cap', () => {
    const daily = [day({ day: '2026-05-31', estimatedCost: 12.4 })]
    const breaches = detectBreaches(daily, { daily: 10, monthly: null }, now)
    expect(breaches).toHaveLength(1)
    expect(breaches[0]).toMatchObject({ period: 'daily', spend: 12.4, cap: 10 })
  })

  it('does not flag when spend equals the cap (strictly over only)', () => {
    const daily = [day({ day: '2026-05-31', estimatedCost: 10 })]
    expect(detectBreaches(daily, { daily: 10, monthly: null }, now)).toEqual([])
  })

  it('flags a monthly breach on month-to-date sum', () => {
    const daily = [
      day({ day: '2026-05-01', estimatedCost: 200 }),
      day({ day: '2026-05-31', estimatedCost: 150 }),
    ]
    const breaches = detectBreaches(daily, { daily: null, monthly: 300 }, now)
    expect(breaches).toHaveLength(1)
    expect(breaches[0]).toMatchObject({ period: 'monthly', spend: 350, cap: 300 })
  })

  it('sums month-to-date across non-adjacent days (1st + mid + last)', () => {
    // A monthly cap must see the WHOLE month, not just today — three scattered
    // spend days (May 1, 15, 31) sum to 350, breaching the 300 cap once.
    const daily = [
      day({ day: '2026-05-01', estimatedCost: 100 }),
      day({ day: '2026-05-15', estimatedCost: 200 }),
      day({ day: '2026-05-31', estimatedCost: 50 }),
    ]
    const breaches = detectBreaches(daily, { daily: null, monthly: 300 }, now)
    expect(breaches).toHaveLength(1)
    expect(breaches[0]).toMatchObject({ period: 'monthly', spend: 350, cap: 300 })
  })

  it('can flag both daily and monthly at once', () => {
    const daily = [
      day({ day: '2026-05-01', estimatedCost: 200 }),
      day({ day: '2026-05-31', estimatedCost: 50 }),
    ]
    const breaches = detectBreaches(daily, { daily: 10, monthly: 200 }, now)
    expect(breaches.map((b) => b.period).sort()).toEqual(['daily', 'monthly'])
  })

  it('never breaches an unset (null) cap', () => {
    const daily = [day({ day: '2026-05-31', estimatedCost: 999 })]
    expect(detectBreaches(daily, { daily: null, monthly: null }, now)).toEqual([])
  })
})

describe('pickUnwarnedBreaches (once-per-breach latch)', () => {
  it('warns once for a breach, then stays silent on the same cap+day', () => {
    const daily = [day({ day: '2026-05-31', estimatedCost: 12 })]
    const budget = { daily: 10, monthly: null }
    const seen = new Set<string>()

    const first = pickUnwarnedBreaches(detectBreaches(daily, budget, now), seen)
    expect(first).toHaveLength(1)

    // Next poll, same day, still over → no new warning.
    const second = pickUnwarnedBreaches(detectBreaches(daily, budget, now), seen)
    expect(second).toEqual([])
  })

  it('re-arms when the cap is raised then re-breached (new key)', () => {
    const daily = [day({ day: '2026-05-31', estimatedCost: 25 })]
    const seen = new Set<string>()

    pickUnwarnedBreaches(detectBreaches(daily, { daily: 10, monthly: null }, now), seen)
    // User raises the cap to 20; spend (25) still over the NEW cap → warn again.
    const again = pickUnwarnedBreaches(
      detectBreaches(daily, { daily: 20, monthly: null }, now),
      seen,
    )
    expect(again).toHaveLength(1)
    expect(again[0]!.cap).toBe(20)
  })

  it('re-arms the daily warning on a new day (new bucket)', () => {
    const seen = new Set<string>()
    const budget = { daily: 10, monthly: null }

    const d1 = [day({ day: '2026-05-31', estimatedCost: 12 })]
    pickUnwarnedBreaches(detectBreaches(d1, budget, new Date('2026-05-31T23:00:00Z')), seen)

    // Next calendar day, today's row is over again → a fresh warning.
    const d2 = [day({ day: '2026-06-01', estimatedCost: 12 })]
    const next = pickUnwarnedBreaches(
      detectBreaches(d2, budget, new Date('2026-06-01T09:00:00Z')),
      seen,
    )
    expect(next).toHaveLength(1)
  })
})

describe('usageWindowDays (the fetch window must cover the breach period)', () => {
  // The watcher fetches a daily series, then sums month-to-date for the monthly
  // cap. With a monthly cap set, a 1-day window only ever returns today's row, so
  // month-to-date is blind to every earlier day — the monthly cap can never
  // breach. The window MUST widen to a full month whenever a monthly cap exists.
  it('uses a 30-day window when a monthly cap is set', () => {
    expect(usageWindowDays({ daily: null, monthly: 300 })).toBe(30)
  })

  it('uses a 30-day window when both caps are set', () => {
    expect(usageWindowDays({ daily: 10, monthly: 300 })).toBe(30)
  })

  it('uses a 1-day window when only a daily cap is set', () => {
    expect(usageWindowDays({ daily: 10, monthly: null })).toBe(1)
  })

  it('uses a 1-day window when no cap is set', () => {
    const empty: Budget = { daily: null, monthly: null }
    expect(usageWindowDays(empty)).toBe(1)
  })
})
