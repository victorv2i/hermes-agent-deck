/**
 * Feature-local mirror of the Usage BFF contract
 * (apps/server/src/usage/usageClient.ts → GET /api/agent-deck/usage?days=N).
 * Kept feature-local to keep features decoupled; the shapes match the BFF's normalized
 * `UsageSummary` (all numeric fields are finite).
 */

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  estimatedCost: number
  actualCost: number
  sessions: number
}

export interface UsageDailyPoint {
  /** ISO date (YYYY-MM-DD). */
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  estimatedCost: number
  actualCost: number
  sessions: number
}

export interface UsageModelBreakdown {
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  sessions: number
  /**
   * The provider Hermes attributed this model's spend to (`billing_provider`,
   * joined from `/api/analytics/models` by the BFF). '' when unavailable. This is
   * the authoritative attribution – NOT inferred from the active provider.
   *
   * Optional on the web type only so older/synthetic payloads (and fixtures) that
   * predate the field still type-check; the live BFF always emits it.
   */
  billingProvider?: string
}

/**
 * Period-level billing mode, derived SERVER-SIDE from the recorded
 * `billingProvider`(s) + cost pair (see apps/server/src/usage/billingMode.ts).
 * The Usage surface renders cost honestly off this: a flat-subscription / OAuth
 * window reads `subscription` ("Included in your subscription") rather than a
 * misleading "$0 / free"; `unknown` means the signal was unavailable, so "$0" is
 * softened rather than implying free.
 */
export type UsageBillingMode = 'subscription' | 'metered' | 'local' | 'unknown'

export interface UsageSummary {
  periodDays: number
  totals: UsageTotals
  daily: UsageDailyPoint[]
  byModel: UsageModelBreakdown[]
  /**
   * Optional on the web type only so older/synthetic payloads (and fixtures)
   * still type-check; the live BFF always emits it. `resolveBillingMode` treats
   * an absent value the same as `unknown` and falls back to the heuristic.
   */
  billingMode?: UsageBillingMode
}

/** The period windows the selector offers. */
export const USAGE_PERIODS = [7, 14, 30] as const
export type UsagePeriod = (typeof USAGE_PERIODS)[number]
