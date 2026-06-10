import { describe, it, expect } from 'vitest'
import { deriveBillingMode, isSubscriptionProvider } from './billingMode'
import type { UsageDailyPoint, UsageModelBreakdown, UsageTotals } from '@agent-deck/protocol'

function daily(over: Partial<UsageDailyPoint> = {}): UsageDailyPoint {
  return {
    day: '2026-05-23',
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

function model(over: Partial<UsageModelBreakdown> = {}): UsageModelBreakdown {
  return {
    model: 'm',
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    sessions: 0,
    billingProvider: '',
    ...over,
  }
}

function totals(over: Partial<UsageTotals> = {}): UsageTotals {
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

describe('isSubscriptionProvider', () => {
  it('matches known flat-subscription / OAuth seats case-insensitively', () => {
    expect(isSubscriptionProvider('openai-codex')).toBe(true)
    expect(isSubscriptionProvider('OpenAI-Codex')).toBe(true)
    expect(isSubscriptionProvider('claude-max')).toBe(true)
    expect(isSubscriptionProvider('copilot')).toBe(true)
  })
  it('returns false for metered/local/unknown providers', () => {
    expect(isSubscriptionProvider('anthropic')).toBe(false)
    expect(isSubscriptionProvider('openrouter')).toBe(false)
    expect(isSubscriptionProvider('local')).toBe(false)
    expect(isSubscriptionProvider('')).toBe(false)
    expect(isSubscriptionProvider(null)).toBe(false)
  })
})

describe('deriveBillingMode', () => {
  it('is metered when a real actual cost landed (any provider)', () => {
    const mode = deriveBillingMode({
      daily: [daily({ inputTokens: 100, actualCost: 0.4 })],
      byModel: [model({ billingProvider: 'openai-codex', inputTokens: 100 })],
      totals: totals({ actualCost: 0.4, inputTokens: 100 }),
    })
    expect(mode).toBe('metered')
  })

  it('is subscription when a flat-seat provider did real work at $0 cost', () => {
    const mode = deriveBillingMode({
      daily: [daily({ inputTokens: 50000, outputTokens: 12000 })],
      byModel: [
        model({ billingProvider: 'openai-codex', inputTokens: 50000, outputTokens: 12000 }),
      ],
      totals: totals({ inputTokens: 50000, outputTokens: 12000 }),
    })
    expect(mode).toBe('subscription')
  })

  it('is subscription when an estimate exists but ~nothing was billed', () => {
    const mode = deriveBillingMode({
      daily: [daily({ inputTokens: 1000, estimatedCost: 0.2 })],
      byModel: [model({ billingProvider: 'anthropic', inputTokens: 1000, estimatedCost: 0.2 })],
      totals: totals({ inputTokens: 1000, estimatedCost: 0.2 }),
    })
    expect(mode).toBe('subscription')
  })

  it('is local when there is no cost and no subscription provider', () => {
    const mode = deriveBillingMode({
      daily: [daily({ inputTokens: 3000 })],
      byModel: [model({ billingProvider: 'local', inputTokens: 3000 })],
      totals: totals({ inputTokens: 3000 }),
    })
    expect(mode).toBe('local')
  })

  it('is unknown when there is real work but NO billing_provider attribution at all', () => {
    const mode = deriveBillingMode({
      daily: [daily({ inputTokens: 3000 })],
      byModel: [model({ billingProvider: '', inputTokens: 3000 })],
      totals: totals({ inputTokens: 3000 }),
    })
    expect(mode).toBe('unknown')
  })

  it('is local for a genuinely empty window (no tokens, no cost)', () => {
    const mode = deriveBillingMode({ daily: [], byModel: [], totals: totals() })
    expect(mode).toBe('local')
  })
})
