import { describe, it, expect } from 'vitest'
import { formatCost, formatTokens, formatTokensFull, formatRelative } from './format'

describe('formatCost', () => {
  it('omits a genuine zero (returns null) so surfaces never show a wall of $0.00', () => {
    expect(formatCost(0)).toBeNull()
    expect(formatCost(-0)).toBeNull()
  })

  it('treats non-finite / nullish input as no-cost (null)', () => {
    expect(formatCost(NaN)).toBeNull()
    expect(formatCost(null)).toBeNull()
    expect(formatCost(undefined)).toBeNull()
    expect(formatCost(Infinity)).toBeNull()
  })

  it('shows an honest "<$0.01" for sub-cent costs rather than a rounded zero', () => {
    expect(formatCost(0.0004)).toBe('<$0.01')
    expect(formatCost(0.009)).toBe('<$0.01')
  })

  it('shows two-decimal dollars otherwise, with thousands separators', () => {
    expect(formatCost(0.01)).toBe('$0.01')
    expect(formatCost(0.21)).toBe('$0.21')
    expect(formatCost(12.5)).toBe('$12.50')
    expect(formatCost(1234.5)).toBe('$1,234.50')
  })
})

describe('formatTokens', () => {
  it('formats small / K / M / B with trimmed zeros', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1000)).toBe('1K')
    expect(formatTokens(1200)).toBe('1.2K')
    expect(formatTokens(2_500_000)).toBe('2.5M')
    expect(formatTokens(3_000_000_000)).toBe('3B')
  })

  it('guards non-finite input', () => {
    expect(formatTokens(NaN)).toBe('0')
  })
})

describe('formatTokensFull', () => {
  it('adds thousands separators', () => {
    expect(formatTokensFull(1234567)).toBe('1,234,567')
    expect(formatTokensFull(0)).toBe('0')
  })
})

describe('formatRelative', () => {
  it('renders a coarse, calm relative age from unix seconds', () => {
    const now = 1_000_000_000_000
    const sec = (msAgo: number) => (now - msAgo) / 1000
    expect(formatRelative(sec(30_000), now)).toBe('just now')
    expect(formatRelative(sec(5 * 60_000), now)).toBe('5m ago')
    expect(formatRelative(sec(3 * 3_600_000), now)).toBe('3h ago')
    expect(formatRelative(sec(2 * 86_400_000), now)).toBe('2d ago')
  })
})
