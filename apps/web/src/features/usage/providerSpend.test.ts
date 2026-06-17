import { describe, it, expect } from 'vitest'
import { groupByProvider } from './providerSpend'
import type { UsageModelBreakdown } from './types'

const model = (over: Partial<UsageModelBreakdown> = {}): UsageModelBreakdown => ({
  model: 'claude-opus-4',
  inputTokens: 0,
  outputTokens: 0,
  estimatedCost: 0,
  sessions: 0,
  ...over,
})

describe('groupByProvider – per-provider rollup of the per-model rows', () => {
  it('groups models by their billingProvider, summing tokens, cost, and sessions', () => {
    const byModel: UsageModelBreakdown[] = [
      model({
        model: 'claude-opus-4',
        billingProvider: 'anthropic',
        inputTokens: 600_000,
        outputTokens: 400_000,
        estimatedCost: 12.5,
        sessions: 5,
      }),
      model({
        model: 'claude-sonnet-4',
        billingProvider: 'anthropic',
        inputTokens: 300_000,
        outputTokens: 200_000,
        estimatedCost: 3.5,
        sessions: 3,
      }),
      model({
        model: 'gpt-5.5',
        billingProvider: 'openai',
        inputTokens: 100_000,
        outputTokens: 50_000,
        estimatedCost: 4.0,
        sessions: 2,
      }),
    ]
    const rows = groupByProvider(byModel)
    expect(rows).toHaveLength(2)
    // Ordered by total tokens, largest first → anthropic leads.
    const anthropic = rows[0]!
    expect(anthropic.provider).toBe('anthropic')
    expect(anthropic.tokens).toBe(1_500_000) // 1M + 500K
    expect(anthropic.cost).toBe(16) // 12.5 + 3.5
    expect(anthropic.sessions).toBe(8)
    expect(anthropic.modelCount).toBe(2)
    expect(anthropic.isSubscription).toBe(false)

    const openai = rows[1]!
    expect(openai.provider).toBe('openai')
    expect(openai.tokens).toBe(150_000)
    expect(openai.cost).toBe(4)
  })

  it('computes share-of-TOTAL tokens so all shares sum to ≤1 (never share-of-peak)', () => {
    const rows = groupByProvider([
      model({ billingProvider: 'anthropic', inputTokens: 1_000_000, estimatedCost: 10 }),
      model({ billingProvider: 'openai', inputTokens: 500_000, estimatedCost: 5 }),
    ])
    const sum = rows.reduce((acc, r) => acc + r.share, 0)
    expect(sum).toBeLessThanOrEqual(1)
    expect(rows[0]!.share).toBeCloseTo(2 / 3, 5)
    expect(rows[1]!.share).toBeCloseTo(1 / 3, 5)
  })

  it('folds rows with no billingProvider attribution into an "Unattributed" bucket', () => {
    const rows = groupByProvider([
      model({ billingProvider: 'anthropic', inputTokens: 100, estimatedCost: 1 }),
      model({ billingProvider: '', inputTokens: 50 }),
      model({ inputTokens: 25 }), // billingProvider undefined
    ])
    const unattributed = rows.find((r) => r.provider === '')
    expect(unattributed).toBeDefined()
    expect(unattributed!.tokens).toBe(75)
    expect(unattributed!.isUnattributed).toBe(true)
  })

  it('HONESTY: flags a subscription/OAuth provider so the UI can hide a misleading $0', () => {
    // openai-codex is a flat-subscription seat: under it the rollup reports $0
    // even when busy. The row must carry isSubscription so the UI says
    // "Included in subscription", never a misleading "$0".
    const rows = groupByProvider([
      model({
        model: 'gpt-5.5-codex',
        billingProvider: 'openai-codex',
        inputTokens: 800_000,
        outputTokens: 200_000,
        estimatedCost: 0,
        sessions: 4,
      }),
    ])
    expect(rows).toHaveLength(1)
    const codex = rows[0]!
    expect(codex.provider).toBe('openai-codex')
    expect(codex.tokens).toBe(1_000_000)
    expect(codex.cost).toBe(0)
    expect(codex.isSubscription).toBe(true)
  })

  it('returns [] for no models', () => {
    expect(groupByProvider([])).toEqual([])
  })
})
