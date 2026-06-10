/**
 * Server-side billing-mode derivation — the authoritative read of HOW the
 * period's usage is billed, computed from signals Hermes actually records.
 *
 * THE BUG THIS FIXES. The stock `/api/analytics/usage` rollup carries tokens + an
 * estimated/actual cost pair but NOT `billing_mode`. A flat-subscription / OAuth
 * seat (e.g. `openai-codex`) has no per-call dollar amount, so under a
 * subscription BOTH costs are $0 even on a busy day — reading cost alone mislabels
 * it "$0 / free / local". We instead use the authoritative per-row
 * `billing_provider` Hermes exposes on `/api/analytics/models` (joined onto each
 * model breakdown as `billingProvider`) to tell a flat-plan window from a truly
 * free/local one.
 *
 * Precedence (most→least authoritative):
 *   1. a real per-call bill landed (actual cost > ε)             → `metered`
 *   2. a known subscription/OAuth provider did real work          → `subscription`
 *   3. a non-trivial estimate exists but ~nothing was billed      → `subscription`
 *   4. no cost, work happened, but NO provider attribution at all → `unknown`
 *      (the /api/analytics/models signal was unavailable — we don't pretend $0
 *      means free; the web softens the label)
 *   5. otherwise (no cost, no subscription provider; or an empty window) → `local`
 */
import type {
  UsageBillingMode,
  UsageDailyPoint,
  UsageModelBreakdown,
  UsageTotals,
} from '@agent-deck/protocol'

/** Below this many dollars a cost is treated as rounding noise, not a real bill. */
const COST_EPSILON = 0.005

/**
 * Provider slugs that bill by a FLAT SUBSCRIPTION / OAuth seat (no per-call
 * meter). Stock hermes authenticates these via OAuth and they carry no metered
 * API key, so the usage rollup reports $0 even when the plan is fully exercised
 * (`agent/usage_pricing.py` routes them to `billing_mode="subscription_included"`,
 * `estimated_cost=0`). Matched case-insensitively; a slug that merely CONTAINS one
 * of these (e.g. `openai-codex`) also counts, so plan variants don't slip through.
 * Curated allow-list, not a guess — anything unknown falls through to cost-based
 * inference, so we never invent a "subscription" label.
 */
const SUBSCRIPTION_PROVIDER_SLUGS = [
  'openai-codex', // OpenAI Codex subscription (OAuth, no metered key)
  'codex',
  'claude-max', // Claude Max subscription (OAuth)
  'claude-pro',
  'copilot', // GitHub Copilot subscription seat
  'chatgpt',
] as const

/**
 * True when the provider is a known flat-subscription / OAuth seat — its tokens
 * are "included in the subscription", not billed per call. Unknown providers
 * return `false` so the caller falls back to cost-based inference.
 */
export function isSubscriptionProvider(providerId: string | null | undefined): boolean {
  if (typeof providerId !== 'string' || providerId.trim() === '') return false
  const slug = providerId.trim().toLowerCase()
  return SUBSCRIPTION_PROVIDER_SLUGS.some((known) => slug.includes(known))
}

export interface BillingModeInput {
  daily: UsageDailyPoint[]
  byModel: UsageModelBreakdown[]
  totals: UsageTotals
}

/** Classify the period's billing mode from the recorded providers + cost pair. */
export function deriveBillingMode({ daily, byModel, totals }: BillingModeInput): UsageBillingMode {
  let est = 0
  let actual = 0
  let tokens = 0
  for (const d of daily) {
    if (Number.isFinite(d.estimatedCost) && d.estimatedCost > 0) est += d.estimatedCost
    if (Number.isFinite(d.actualCost) && d.actualCost > 0) actual += d.actualCost
    tokens += d.inputTokens + d.outputTokens
  }
  // Fall back to totals when daily is empty but the grand totals carry work
  // (e.g. a window the dashboard rolled up only into totals).
  if (tokens === 0) tokens = totals.inputTokens + totals.outputTokens
  if (est === 0 && totals.estimatedCost > 0) est = totals.estimatedCost
  if (actual === 0 && totals.actualCost > 0) actual = totals.actualCost

  // 1. A real per-call bill is metered no matter the provider (a metered key may
  //    be configured even on an OAuth-capable provider).
  if (actual > COST_EPSILON) return 'metered'

  const hasSubscriptionProvider = byModel.some((m) => isSubscriptionProvider(m.billingProvider))
  // 2. A known subscription/OAuth seat with real work is on a flat plan —
  //    included, not free, not per-call — even when the rollup reports $0.
  if (hasSubscriptionProvider && tokens > 0) return 'subscription'

  // 3. A non-trivial estimate that wasn't actually billed reads as a plan-covered
  //    (priced model run under a flat plan).
  if (est > COST_EPSILON) return 'subscription'

  // 4. Work happened with NO provider attribution at all (the
  //    /api/analytics/models join was unavailable) and no cost: we genuinely
  //    don't know it's free, so don't imply "$0 = free".
  const hasAnyAttribution = byModel.some((m) => m.billingProvider.trim() !== '')
  if (tokens > 0 && !hasAnyAttribution) return 'unknown'

  // 5. No cost, attributed to a non-subscription provider (or an empty window):
  //    a local / unpriced model — there is genuinely nothing to bill.
  return 'local'
}
