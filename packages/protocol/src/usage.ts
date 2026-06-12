/**
 * Usage BFF wire contract — the shape `GET /api/agent-deck/usage?days=N` returns.
 *
 * zod is the source of truth: the BFF validates its response against
 * these schemas and the web infers its types from `z.infer`, so the cost surface
 * and the BFF can never silently drift.
 *
 * THE BILLING-HONESTY SIGNAL. The stock dashboard `GET /api/analytics/usage`
 * rollup (hermes_cli/web_server.py:3170) does NOT select `billing_mode` — its
 * three SUM queries carry tokens + an estimated/actual cost pair only. A FLAT
 * SUBSCRIPTION / OAuth seat (e.g. `openai-codex`) has no per-call dollar amount,
 * so under a subscription BOTH costs are $0 even on a heavily-used day; reading
 * cost alone would mislabel that busy window "free / no billed cost".
 *
 * The authoritative per-row signal Hermes DOES expose is `billing_provider`, on
 * the SEPARATE real route `GET /api/analytics/models` (web_server.py:3239, which
 * `SELECT ... billing_provider ... GROUP BY model, billing_provider`). The BFF
 * joins it onto each model row here as {@link UsageModelBreakdown.billingProvider}
 * and derives a period-level {@link UsageSummary.billingMode} server-side, so the
 * web renders an HONEST label ("Included in your subscription") for genuine
 * subscription usage while keeping real $ for metered/API-key usage.
 */
import { z } from 'zod'

/**
 * How the period's usage is billed, derived server-side from the recorded
 * `billing_provider`(s) + the cost pair:
 *   - `subscription` — a flat plan / OAuth seat covers it (tokens, not per-call $).
 *   - `metered`      — a real per-call bill landed (aggregator or raw API key).
 *   - `local`        — no rate card at all (a local / unpriced model).
 *   - `unknown`      — the `/api/analytics/models` signal was unavailable, so the
 *     mode could not be resolved authoritatively; the web softens "$0" rather
 *     than implying "free".
 */
export const UsageBillingMode = z.enum(['subscription', 'metered', 'local', 'unknown'])
export type UsageBillingMode = z.infer<typeof UsageBillingMode>

/** Grand totals over the window. All numbers are finite (the BFF coerces nulls). */
export const UsageTotals = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  reasoningTokens: z.number(),
  estimatedCost: z.number(),
  actualCost: z.number(),
  sessions: z.number(),
})
export type UsageTotals = z.infer<typeof UsageTotals>

/** One per-day usage point. All numbers are finite. */
export const UsageDailyPoint = z.object({
  /** ISO date (YYYY-MM-DD). */
  day: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  reasoningTokens: z.number(),
  estimatedCost: z.number(),
  actualCost: z.number(),
  sessions: z.number(),
})
export type UsageDailyPoint = z.infer<typeof UsageDailyPoint>

/** One per-model breakdown row. All numbers are finite. */
export const UsageModelBreakdown = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  estimatedCost: z.number(),
  sessions: z.number(),
  /**
   * The provider Hermes attributed this model's spend to (`billing_provider`
   * from `GET /api/analytics/models`), e.g. `openai-codex`. Empty string when
   * that signal was unavailable. This is the authoritative billing attribution —
   * NOT inferred from the currently-active provider.
   */
  billingProvider: z.string(),
})
export type UsageModelBreakdown = z.infer<typeof UsageModelBreakdown>

/**
 * Where a per-run receipt's token numbers came from:
 *   - `run_event`     — the gateway's `run.completed` usage payload. EXACT for the
 *     run: the gateway creates a fresh agent per `/v1/runs` run, whose token
 *     counters start at 0 and accumulate only that run's own model calls
 *     (api_server.py `_run_and_close` + agent_init counters). Concurrent runs or
 *     background forks sharing the session id can never leak into it.
 *   - `session_delta` — a session-row before/after token delta bracketing the run.
 *     NOT exact: anything else writing to the same session during the run (e.g. a
 *     background fork) inflates it, so a UI must say "the session grew by N during
 *     this run", never "this run cost exactly N". Reserved — the current deck only
 *     ships `run_event`.
 */
export const RunReceiptSource = z.enum(['run_event', 'session_delta'])
export type RunReceiptSource = z.infer<typeof RunReceiptSource>

/**
 * The per-run cost receipt rendered under a completed assistant turn. Built from
 * the run's `run.completed` usage (exact tokens, see {@link RunReceiptSource})
 * joined with the period billing mode the Usage surface already reconciles.
 *
 * HONESTY RULES (the receipt may never out-claim its sources):
 *   - `estCostUsd` is null unless a REAL per-run dollar figure exists. Hermes's
 *     run lifecycle carries tokens only (no cost field), so deriving dollars from
 *     window aggregates would be fabrication — we don't.
 *   - `cacheReadTokens` is absent when the source didn't report it (the gateway's
 *     run usage omits cache reads even though session rows track them).
 *   - `billingMode` 'unknown' means the billing signal was unavailable — the UI
 *     drops the billing segment rather than implying "free".
 */
export const RunReceipt = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  /** Real per-run dollars, or null when no per-run price exists (never derived). */
  estCostUsd: z.number().nullable(),
  billingMode: UsageBillingMode,
  source: RunReceiptSource,
  /** Human note on what the numbers measure (e.g. "Measured for this run"). */
  attribution: z.string().optional(),
})
export type RunReceipt = z.infer<typeof RunReceipt>

/** The BFF's normalized usage payload. */
export const UsageSummary = z.object({
  /** The window actually applied (echoed from the dashboard). */
  periodDays: z.number(),
  totals: UsageTotals,
  daily: z.array(UsageDailyPoint),
  byModel: z.array(UsageModelBreakdown),
  /**
   * Period-level billing mode, derived server-side from the recorded
   * `billingProvider`(s) + the cost pair. The web renders cost honestly off this
   * (subscription → "Included in your subscription"; metered → real $).
   */
  billingMode: UsageBillingMode,
})
export type UsageSummary = z.infer<typeof UsageSummary>
