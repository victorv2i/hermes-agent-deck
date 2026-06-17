import { describe, it, expect } from 'vitest'
import { cacheHitRatio, formatCacheHitPct } from './cacheHit'

describe('cacheHitRatio', () => {
  it('is cacheRead / (cacheRead + nonCachedInput)', () => {
    // 800 cached against 200 fresh input → 800 / 1000 = 0.8.
    expect(cacheHitRatio({ cacheReadTokens: 800, inputTokens: 200 })).toBeCloseTo(0.8, 10)
  })

  it('returns null (honest empty) when there is no prompt-side usage at all', () => {
    // No input and no cache → divide-by-zero → null, the "–" empty state.
    expect(cacheHitRatio({ cacheReadTokens: 0, inputTokens: 0 })).toBeNull()
  })

  it('returns a real 0 when input exists but nothing was a cache hit', () => {
    // 0% is a genuine, measurable answer – NOT the empty state.
    expect(cacheHitRatio({ cacheReadTokens: 0, inputTokens: 5000 })).toBe(0)
  })

  it('returns 1 when every prompt-side token was a cache hit', () => {
    expect(cacheHitRatio({ cacheReadTokens: 1200, inputTokens: 0 })).toBe(1)
  })

  it('treats negative / non-finite inputs as zero', () => {
    expect(cacheHitRatio({ cacheReadTokens: Number.NaN, inputTokens: -5 })).toBeNull()
    expect(cacheHitRatio({ cacheReadTokens: 100, inputTokens: Number.POSITIVE_INFINITY })).toBe(1)
  })
})

describe('formatCacheHitPct', () => {
  it('renders a whole-percent label', () => {
    expect(formatCacheHitPct(0.842)).toBe('84%')
    expect(formatCacheHitPct(0)).toBe('0%')
    expect(formatCacheHitPct(1)).toBe('100%')
  })

  it('renders "–" for the null empty state', () => {
    expect(formatCacheHitPct(null)).toBe('–')
  })

  it('clamps out-of-range ratios into 0..100%', () => {
    expect(formatCacheHitPct(1.5)).toBe('100%')
    expect(formatCacheHitPct(-0.2)).toBe('0%')
  })
})
