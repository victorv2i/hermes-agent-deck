import { describe, it, expect } from 'vitest'
import {
  approxHourlyRate,
  costByModel,
  dailyAverageSpend,
  dominantCostModel,
  isoDay,
  monthToDateSpend,
  pointSpend,
  summaryTodaySpend,
  todaySpend,
} from './burnRate'
import type { UsageDailyPoint, UsageModelBreakdown, UsageSummary } from './types'

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

function model(over: Partial<UsageModelBreakdown> & { model: string }): UsageModelBreakdown {
  return { inputTokens: 0, outputTokens: 0, estimatedCost: 0, sessions: 0, ...over }
}

describe('pointSpend', () => {
  it('prefers a real billed actualCost over the estimate', () => {
    expect(pointSpend({ estimatedCost: 5, actualCost: 3 })).toBe(3)
  })
  it('falls back to estimatedCost when actual is zero/absent', () => {
    expect(pointSpend({ estimatedCost: 4.2, actualCost: 0 })).toBe(4.2)
  })
  it('is 0 when neither is a positive finite number', () => {
    expect(pointSpend({ estimatedCost: 0, actualCost: 0 })).toBe(0)
    expect(pointSpend({ estimatedCost: Number.NaN, actualCost: Number.NaN })).toBe(0)
  })
})

describe('todaySpend', () => {
  const now = new Date('2026-05-31T10:00:00Z')
  it("returns today's UTC-matched spend", () => {
    const daily = [
      day({ day: '2026-05-30', estimatedCost: 9 }),
      day({ day: '2026-05-31', estimatedCost: 4.32 }),
    ]
    expect(todaySpend(daily, now)).toBe(4.32)
  })
  it('is 0 when today has no row', () => {
    expect(todaySpend([day({ day: '2026-05-29', estimatedCost: 9 })], now)).toBe(0)
  })
  it('reads through a full summary', () => {
    const summary = { daily: [day({ day: '2026-05-31', estimatedCost: 2 })] } as UsageSummary
    expect(summaryTodaySpend(summary, now)).toBe(2)
    expect(summaryTodaySpend(undefined, now)).toBe(0)
  })
})

describe('monthToDateSpend', () => {
  it('sums only days in the same UTC calendar month', () => {
    const now = new Date('2026-05-31T10:00:00Z')
    const daily = [
      day({ day: '2026-04-30', estimatedCost: 100 }), // prior month – excluded
      day({ day: '2026-05-01', estimatedCost: 5 }),
      day({ day: '2026-05-15', actualCost: 7 }),
      day({ day: '2026-05-31', estimatedCost: 4 }),
    ]
    expect(monthToDateSpend(daily, now)).toBe(16)
  })
})

describe('dailyAverageSpend', () => {
  it('averages only spend-bearing days (quiet $0 days excluded)', () => {
    const daily = [
      day({ day: '2026-05-28', estimatedCost: 0 }),
      day({ day: '2026-05-29', estimatedCost: 6 }),
      day({ day: '2026-05-30', estimatedCost: 0 }),
      day({ day: '2026-05-31', estimatedCost: 10 }),
    ]
    expect(dailyAverageSpend(daily)).toBe(8)
  })
  it('is 0 with no spend', () => {
    expect(dailyAverageSpend([day({ day: '2026-05-31' })])).toBe(0)
  })
})

describe('approxHourlyRate', () => {
  it('divides spend by hours elapsed in the UTC day', () => {
    const now = new Date('2026-05-31T10:00:00Z') // 10h elapsed
    const daily = [day({ day: '2026-05-31', estimatedCost: 20 })]
    expect(approxHourlyRate(daily, now)).toBeCloseTo(2, 5)
  })
  it('clamps the window to a 1h minimum so an early spike is not absurd', () => {
    const now = new Date('2026-05-31T00:15:00Z') // 0.25h elapsed → clamped to 1h
    const daily = [day({ day: '2026-05-31', estimatedCost: 5 })]
    expect(approxHourlyRate(daily, now)).toBe(5)
  })
  it('is 0 on an idle day', () => {
    const now = new Date('2026-05-31T10:00:00Z')
    expect(approxHourlyRate([day({ day: '2026-05-31' })], now)).toBe(0)
  })
})

describe('costByModel', () => {
  it('orders priced models by cost desc and computes both shares', () => {
    const rows = costByModel([
      model({ model: 'sonnet', estimatedCost: 1, inputTokens: 50, outputTokens: 50 }),
      model({ model: 'opus', estimatedCost: 9, inputTokens: 10, outputTokens: 10 }),
    ])
    expect(rows.map((r) => r.model)).toEqual(['opus', 'sonnet'])
    expect(rows[0]!.share).toBe(1)
    expect(rows[0]!.shareOfTotal).toBeCloseTo(0.9, 5)
    expect(rows[1]!.share).toBeCloseTo(1 / 9, 5)
  })
  it('drops $0 models and returns [] when nothing is billed', () => {
    expect(costByModel([model({ model: 'local', estimatedCost: 0 })])).toEqual([])
    const rows = costByModel([
      model({ model: 'opus', estimatedCost: 3 }),
      model({ model: 'local', estimatedCost: 0 }),
    ])
    expect(rows.map((r) => r.model)).toEqual(['opus'])
  })
})

describe('dominantCostModel', () => {
  it('returns the leader when it is >=60% of spend and total clears the floor', () => {
    const leader = dominantCostModel([
      model({ model: 'opus', estimatedCost: 9 }),
      model({ model: 'sonnet', estimatedCost: 1 }),
    ])
    expect(leader?.model).toBe('opus')
  })
  it('is null on a balanced spread (no clear leader)', () => {
    expect(
      dominantCostModel([
        model({ model: 'opus', estimatedCost: 5 }),
        model({ model: 'sonnet', estimatedCost: 5 }),
      ]),
    ).toBeNull()
  })
  it('is null below the minimum total spend (trivial amounts)', () => {
    expect(
      dominantCostModel([model({ model: 'opus', estimatedCost: 0.5 })], { minTotal: 1 }),
    ).toBeNull()
  })
})

describe('isoDay', () => {
  it('formats a Date as a UTC YYYY-MM-DD', () => {
    expect(isoDay(new Date('2026-05-31T23:59:59Z'))).toBe('2026-05-31')
  })
})
