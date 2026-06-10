import { describe, it, expect } from 'vitest'
import { UsageBillingMode, UsageSummary } from './usage'

describe('UsageSummary DTO', () => {
  it('parses a fully-populated metered usage payload', () => {
    const parsed = UsageSummary.parse({
      periodDays: 7,
      totals: {
        inputTokens: 20000,
        outputTokens: 5500,
        cacheReadTokens: 800,
        reasoningTokens: 200,
        estimatedCost: 0.63,
        actualCost: 0.4,
        sessions: 8,
      },
      daily: [
        {
          day: '2026-05-23',
          inputTokens: 12000,
          outputTokens: 3400,
          cacheReadTokens: 800,
          reasoningTokens: 200,
          estimatedCost: 0.42,
          actualCost: 0.4,
          sessions: 5,
        },
      ],
      byModel: [
        {
          model: 'anthropic/claude-opus',
          inputTokens: 15000,
          outputTokens: 4500,
          estimatedCost: 0.55,
          sessions: 6,
          billingProvider: 'anthropic',
        },
      ],
      billingMode: 'metered',
    })
    expect(parsed.billingMode).toBe('metered')
    expect(parsed.byModel[0]!.billingProvider).toBe('anthropic')
  })

  it('parses a subscription payload (the $0-but-busy case)', () => {
    const parsed = UsageSummary.parse({
      periodDays: 7,
      totals: {
        inputTokens: 50000,
        outputTokens: 12000,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        sessions: 9,
      },
      daily: [],
      byModel: [
        {
          model: 'gpt-5.4',
          inputTokens: 50000,
          outputTokens: 12000,
          estimatedCost: 0,
          sessions: 9,
          billingProvider: 'openai-codex',
        },
      ],
      billingMode: 'subscription',
    })
    expect(parsed.billingMode).toBe('subscription')
  })

  it('constrains billingMode to the governed set', () => {
    expect(UsageBillingMode.options).toEqual(['subscription', 'metered', 'local', 'unknown'])
    expect(() => UsageBillingMode.parse('included')).toThrow()
  })

  it('requires billingProvider on every model row (empty string when unknown)', () => {
    expect(() =>
      UsageSummary.parse({
        periodDays: 7,
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          estimatedCost: 0,
          actualCost: 0,
          sessions: 0,
        },
        daily: [],
        byModel: [{ model: 'm1', inputTokens: 1, outputTokens: 1, estimatedCost: 0, sessions: 1 }],
        billingMode: 'unknown',
      }),
    ).toThrow()
  })
})
