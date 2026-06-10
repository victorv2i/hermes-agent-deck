import { describe, it, expect } from 'vitest'
import { formatDayLabel, formatDayFull, formatTokens, niceAxisMax } from './format'

// Token + cost formatting now live in lib/format.ts (one source of truth) and
// are covered by src/lib/format.test.ts. This file covers the Usage-specific
// date formatters only.

describe('formatDayLabel / formatDayFull', () => {
  it('renders a stable UTC weekday+day and a full date', () => {
    // 2026-05-23 is a Saturday (UTC).
    expect(formatDayLabel('2026-05-23')).toBe('Sat 23')
    expect(formatDayFull('2026-05-23')).toBe('May 23, 2026')
  })

  it('falls back to the raw string for a bad date', () => {
    expect(formatDayLabel('not-a-date')).toBe('not-a-date')
  })
})

describe('niceAxisMax', () => {
  it('rounds a raw data peak up to a clean 1/2/5 axis ceiling', () => {
    expect(niceAxisMax(991_900)).toBe(1_000_000)
    expect(niceAxisMax(8_700_000)).toBe(10_000_000)
    expect(niceAxisMax(1_500)).toBe(2_000)
    expect(niceAxisMax(3_200)).toBe(5_000)
    // An already-clean ceiling is kept as-is.
    expect(niceAxisMax(2_000_000)).toBe(2_000_000)
  })

  it('keeps both the peak and midline ticks round once formatted', () => {
    // The exact bug: a 991.9K peak rendered a "991.9K" tick; now 1M / 500K.
    const max = niceAxisMax(991_900)
    expect(formatTokens(max)).toBe('1M')
    expect(formatTokens(max * 0.5)).toBe('500K')
  })

  it('falls back to 1 for zero, negative, or non-finite input', () => {
    expect(niceAxisMax(0)).toBe(1)
    expect(niceAxisMax(-5)).toBe(1)
    expect(niceAxisMax(Number.NaN)).toBe(1)
  })
})
