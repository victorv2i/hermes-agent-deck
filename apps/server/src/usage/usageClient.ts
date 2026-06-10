/**
 * Typed wrapper over the loopback dashboard's token/cost analytics endpoints
 * (`GET /api/analytics/usage?days=N` + `GET /api/analytics/models?days=N`, see
 * hermes_cli/web_server.py:3170 / :3239).
 *
 * The usage route returns four fields:
 *   - `daily`:       per-day rollups (date + token sums + cost + session count)
 *   - `by_model`:    per-model rollups (model + token sums + cost + session count)
 *   - `totals`:      a single grand-total row over the window
 *   - `period_days`: the window the dashboard actually applied
 *
 * Because the dashboard's SQL uses `SUM(...)`, columns can come back `null`
 * (e.g. an empty window, or a column never populated). We coerce every numeric
 * field to a finite number here so downstream consumers (the BFF route + the
 * web Usage page) never have to defend against null/NaN.
 *
 * THE BILLING-HONESTY JOIN. The `/api/analytics/usage` rollup does NOT select
 * `billing_mode` / `billing_provider` (web_server.py:3170 — tokens + an
 * estimated/actual cost pair only), so a flat-subscription / OAuth seat reads as
 * a misleading "$0 / free" even on a busy day. The authoritative per-row signal
 * Hermes DOES expose is `billing_provider`, on the SEPARATE real route
 * `GET /api/analytics/models` (web_server.py:3239, `SELECT ... billing_provider
 * ... GROUP BY model, billing_provider`). We fetch it (best-effort), join it onto
 * each `by_model` row, and derive a period-level {@link UsageBillingMode}
 * server-side so the web renders cost HONESTLY. When the models route is
 * unavailable the join degrades to no attribution + a cost-only billing read.
 */
import type { DashboardClient } from '../hermes/dashboardClient'
import type { UsageBillingMode, UsageSummary } from '@agent-deck/protocol'
import { UsageSummary as UsageSummarySchema } from '@agent-deck/protocol'
import { deriveBillingMode } from './billingMode'

/** Raw per-day row as the dashboard returns it (numbers may be null). */
interface RawDailyRow {
  day?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_tokens?: number | null
  reasoning_tokens?: number | null
  estimated_cost?: number | null
  actual_cost?: number | null
  sessions?: number | null
}

/** Raw per-model row as the usage rollup returns it (numbers may be null). */
interface RawModelRow {
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  estimated_cost?: number | null
  sessions?: number | null
}

/**
 * Raw `/api/analytics/models` row (web_server.py:3239). The fields we consume are
 * `model` (join key) and `provider` (the `billing_provider` Hermes attributed the
 * spend to) + the cost pair, which feeds the period billing-mode read.
 */
interface RawAnalyticsModelRow {
  model?: string | null
  provider?: string | null
  estimated_cost?: number | null
  actual_cost?: number | null
}

interface RawAnalyticsModelsResponse {
  models?: RawAnalyticsModelRow[] | null
}

interface RawTotals {
  total_input?: number | null
  total_output?: number | null
  total_cache_read?: number | null
  total_reasoning?: number | null
  total_estimated_cost?: number | null
  total_actual_cost?: number | null
  total_sessions?: number | null
}

interface RawUsageResponse {
  daily?: RawDailyRow[] | null
  by_model?: RawModelRow[] | null
  totals?: RawTotals | null
  period_days?: number | null
}

// The normalized shapes are owned by the protocol package (zod source of truth);
// re-exported here so existing importers (`./usageClient`) keep working.
export type {
  UsageDailyPoint,
  UsageModelBreakdown,
  UsageTotals,
  UsageSummary,
  UsageBillingMode,
} from '@agent-deck/protocol'

// Local aliases for use within this module (the imports above are type-only
// re-exports; these bring the names into value-less scope for annotations).
import type { UsageDailyPoint, UsageModelBreakdown, UsageTotals } from '@agent-deck/protocol'

/** Coerce any value to a finite number, falling back to 0 (handles null SUMs). */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeDaily(rows: RawDailyRow[] | null | undefined): UsageDailyPoint[] {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r): r is RawDailyRow => !!r && typeof r.day === 'string')
    .map((r) => ({
      day: r.day as string,
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cacheReadTokens: num(r.cache_read_tokens),
      reasoningTokens: num(r.reasoning_tokens),
      estimatedCost: num(r.estimated_cost),
      actualCost: num(r.actual_cost),
      sessions: num(r.sessions),
    }))
}

/**
 * Normalize the usage rollup's per-model rows, joining the authoritative
 * `billing_provider` from the `/api/analytics/models` map (keyed by model id).
 * Missing from the map → `billingProvider: ''` (no attribution, never invented).
 */
function normalizeByModel(
  rows: RawModelRow[] | null | undefined,
  providerByModel: Map<string, string>,
): UsageModelBreakdown[] {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r): r is RawModelRow => !!r && typeof r.model === 'string')
    .map((r) => {
      const model = r.model as string
      return {
        model,
        inputTokens: num(r.input_tokens),
        outputTokens: num(r.output_tokens),
        estimatedCost: num(r.estimated_cost),
        sessions: num(r.sessions),
        billingProvider: providerByModel.get(model) ?? '',
      }
    })
}

/**
 * Build the model→billing_provider map from a `/api/analytics/models` payload.
 * Best-effort: a null/garbled payload yields an empty map (no attribution).
 */
function providerMap(models: RawAnalyticsModelsResponse | null): Map<string, string> {
  const map = new Map<string, string>()
  const rows = Array.isArray(models?.models) ? models!.models : []
  for (const r of rows) {
    const model = typeof r?.model === 'string' ? r.model : ''
    const provider = typeof r?.provider === 'string' ? r.provider : ''
    if (model && provider && !map.has(model)) map.set(model, provider)
  }
  return map
}

function normalizeTotals(t: RawTotals | null | undefined): UsageTotals {
  return {
    inputTokens: num(t?.total_input),
    outputTokens: num(t?.total_output),
    cacheReadTokens: num(t?.total_cache_read),
    reasoningTokens: num(t?.total_reasoning),
    estimatedCost: num(t?.total_estimated_cost),
    actualCost: num(t?.total_actual_cost),
    sessions: num(t?.total_sessions),
  }
}

/** Minimal slice of DashboardClient this client needs (eases test injection). */
export interface UsageDashboard {
  getJson<T>(path: string): Promise<T>
}

/**
 * Fetch and normalize token/cost analytics for the last `days` days. Delegates
 * auth + transport to the shared {@link DashboardClient}.
 */
export class UsageClient {
  constructor(private readonly dashboard: UsageDashboard | DashboardClient) {}

  async getUsage(days: number): Promise<UsageSummary> {
    // The usage rollup is REQUIRED (a failure propagates → the route maps it to a
    // 502). The per-model billing_provider join is BEST-EFFORT: if
    // /api/analytics/models is unavailable we still return usage, just without
    // provider attribution and with a cost-only billing read.
    const [raw, models] = await Promise.all([
      this.dashboard.getJson<RawUsageResponse>(`/api/analytics/usage?days=${days}`),
      this.dashboard
        .getJson<RawAnalyticsModelsResponse>(`/api/analytics/models?days=${days}`)
        .catch(() => null),
    ])

    const byModel = normalizeByModel(raw?.by_model, providerMap(models))
    const daily = normalizeDaily(raw?.daily)
    const totals = normalizeTotals(raw?.totals)
    const billingMode: UsageBillingMode = deriveBillingMode({ daily, byModel, totals })

    // Validate against the protocol DTO so the wire shape can never silently
    // drift from the zod source of truth.
    return UsageSummarySchema.parse({
      periodDays: num(raw?.period_days) || days,
      totals,
      daily,
      byModel,
      billingMode,
    })
  }
}
