/**
 * Per-PROVIDER rollup of the per-model usage rows — the companion to the
 * per-model breakdown. The BFF already attributes each model's spend to the
 * provider Hermes recorded it under (`billingProvider`, joined from
 * `/api/analytics/models`); this groups those rows by that attribution so the
 * Usage surface can answer "where did my tokens / dollars go, by provider?".
 *
 * HONESTY (mirrors billingMode.ts + CostInsights.tsx): a flat-subscription /
 * OAuth provider (e.g. `openai-codex`) reports a $0 cost pair even when busy, so
 * each row carries `isSubscription` and the UI shows "Included in subscription"
 * rather than a misleading "$0". Rows with NO recorded attribution fold into a
 * single `''` bucket flagged `isUnattributed` — never invented, never dropped.
 *
 * Shares are share-of-TOTAL tokens (same rule as ModelBreakdown), so the bar
 * widths/percentages add up to ≤100% — never share-of-peak (which can exceed
 * 100%).
 */
import type { UsageModelBreakdown } from './types'
import { isSubscriptionProvider } from './subscriptionProviders'

/** A provider's aggregated usage across all of its models in the period. */
export interface ProviderSpendRow {
  /** The recorded `billingProvider` slug; `''` for the unattributed bucket. */
  provider: string
  /** Input + output tokens summed across this provider's models. */
  tokens: number
  /** Summed per-model estimatedCost (the only cost the per-model rows carry). */
  cost: number
  /** Summed sessions across this provider's models. */
  sessions: number
  /** How many distinct models rolled into this provider. */
  modelCount: number
  /** Share of total tokens in the period (0..1), for the bar + %. */
  share: number
  /** True when the provider is a known flat-subscription / OAuth seat. */
  isSubscription: boolean
  /** True when this is the no-attribution bucket (`provider === ''`). */
  isUnattributed: boolean
}

/**
 * Group the per-model rows by their `billingProvider`, summing tokens, cost, and
 * sessions. Ordered by total tokens (largest first). Missing/blank attribution
 * folds into a single `''` bucket. Returns [] for no models.
 */
export function groupByProvider(byModel: UsageModelBreakdown[]): ProviderSpendRow[] {
  if (byModel.length === 0) return []

  const buckets = new Map<
    string,
    { tokens: number; cost: number; sessions: number; modelCount: number }
  >()
  for (const m of byModel) {
    const provider = typeof m.billingProvider === 'string' ? m.billingProvider.trim() : ''
    const tokens = (m.inputTokens || 0) + (m.outputTokens || 0)
    const cost =
      typeof m.estimatedCost === 'number' && Number.isFinite(m.estimatedCost) && m.estimatedCost > 0
        ? m.estimatedCost
        : 0
    const prev = buckets.get(provider) ?? { tokens: 0, cost: 0, sessions: 0, modelCount: 0 }
    prev.tokens += tokens
    prev.cost += cost
    prev.sessions += m.sessions || 0
    prev.modelCount += 1
    buckets.set(provider, prev)
  }

  // Share-of-TOTAL tokens (never share-of-peak) so every % adds up to ≤100.
  const grandTotal = Math.max(
    1,
    Array.from(buckets.values()).reduce((acc, b) => acc + b.tokens, 0),
  )

  return Array.from(buckets.entries())
    .map(([provider, b]) => ({
      provider,
      tokens: b.tokens,
      cost: b.cost,
      sessions: b.sessions,
      modelCount: b.modelCount,
      share: b.tokens / grandTotal,
      isSubscription: isSubscriptionProvider(provider),
      isUnattributed: provider === '',
    }))
    .sort((a, b) => b.tokens - a.tokens)
}
