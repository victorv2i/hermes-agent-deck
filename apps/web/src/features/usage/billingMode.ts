/**
 * Billing-mode inference — the read of HOW the account is billed.
 *
 * The PRIMARY, authoritative signal is the ACTIVE PROVIDER. A flat
 * subscription / OAuth provider (e.g. `openai-codex`) bills by a plan, not per
 * call, so the /api/analytics/usage rollup reports $0 even on a heavily-used day
 * — cost alone would mislabel it "local / no billed cost". When the active
 * provider is a known subscription/OAuth seat, any real token usage is
 * `subscription` (included in the plan), regardless of the $0 cost pair.
 *
 * The SECONDARY signal — used only when the provider is unknown / not given — is
 * the estimated/actual cost pair, the one billing field stock exposes (there is
 * NO `billing_provider` on by_model). This branch is BEST-EFFORT and the UI must
 * not present it as ground truth:
 *   - subscription — an estimate exists but ~nothing was actually billed
 *     (a priced model run under a flat plan): est>0 & actual~=0.
 *   - metered      — a real per-call bill landed:                est>0 & actual>0.
 *   - local        — no cost signal at all (a local model):      est~=0 & actual~=0.
 *
 * We sum the whole period rather than trust any single day, so one quiet day
 * doesn't flip the read. The epsilon keeps sub-cent rounding noise from a
 * provider's rollup reading as a real "billed" amount.
 */
import type { UsageBillingMode, UsageDailyPoint } from './types'
import { isSubscriptionProvider } from './subscriptionProviders'

export type BillingMode = 'subscription' | 'metered' | 'local'

/** Below this many dollars a cost is treated as rounding noise, not a real bill. */
const COST_EPSILON = 0.005

/**
 * Classify the period's billing mode.
 *
 * @param daily       per-day usage points (cost + token columns).
 * @param providerId  the ACTIVE provider slug (from `/api/agent-deck/models`).
 *   When it names a known subscription/OAuth seat, real token usage is reported
 *   as `subscription` even with a $0 cost pair — the authoritative fix for the
 *   "subscription reads as local-free" bug. Omit it to fall back to cost-only
 *   inference (unchanged, backwards-compatible).
 */
export function billingMode(daily: UsageDailyPoint[], providerId?: string | null): BillingMode {
  let est = 0
  let actual = 0
  let tokens = 0
  for (const d of daily) {
    if (Number.isFinite(d.estimatedCost) && d.estimatedCost > 0) est += d.estimatedCost
    if (Number.isFinite(d.actualCost) && d.actualCost > 0) actual += d.actualCost
    tokens += d.inputTokens + d.outputTokens
  }
  // A real per-call bill is metered no matter the provider (a metered key may be
  // configured even on an OAuth-capable provider).
  if (actual > COST_EPSILON) return 'metered'
  // Authoritative: a known subscription/OAuth seat with real work is on a plan —
  // included, not free, not per-call — even when the rollup reports $0.
  if (isSubscriptionProvider(providerId) && tokens > 0) return 'subscription'
  if (est > COST_EPSILON) return 'subscription'
  return 'local'
}

/**
 * Resolve the billing mode the UI should render, preferring the AUTHORITATIVE
 * server-derived mode (from the recorded `billing_provider` on
 * `/api/analytics/models`) and only falling back to the active-provider + cost
 * heuristic when the server couldn't determine it (`unknown` / absent).
 *
 * The server mode is the honest source: it reflects the providers that actually
 * recorded sessions in the window, not merely whatever provider is active NOW.
 */
export function resolveBillingMode(
  serverMode: UsageBillingMode | undefined,
  daily: UsageDailyPoint[],
  providerId?: string | null,
): BillingMode {
  if (serverMode === 'subscription' || serverMode === 'metered' || serverMode === 'local') {
    return serverMode
  }
  // `unknown` (or a payload without the field): fall back to the local heuristic.
  return billingMode(daily, providerId)
}

/** Total input+output tokens across the period — the figure the plan card shows. */
export function totalTokens(daily: UsageDailyPoint[]): number {
  let sum = 0
  for (const d of daily) sum += d.inputTokens + d.outputTokens
  return sum
}
