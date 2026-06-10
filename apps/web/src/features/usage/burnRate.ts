/**
 * Burn-rate math — the pure, testable core of the Cost Cockpit.
 *
 * Every cost figure the cockpit shows (the header burn pill, the budget alert,
 * the Usage trend line + cost share) derives from the same normalized
 * `UsageSummary` that already flows through GET /api/agent-deck/usage. These are
 * plain functions over that shape so the UI stays thin and the honest accounting
 * (which cost field, which window) is unit-tested in one place.
 *
 * Cost preference: we report `actualCost` when the provider billed a real number
 * for a day, else fall back to `estimatedCost`. This mirrors the Usage surface's
 * "actual when present, estimated otherwise" framing so the pill and the page
 * never disagree.
 */
import type { UsageDailyPoint, UsageModelBreakdown, UsageSummary } from './types'

/** The honest spend for one day: actual when billed, else estimated. */
export function pointSpend(point: Pick<UsageDailyPoint, 'estimatedCost' | 'actualCost'>): number {
  const actual = point.actualCost
  if (typeof actual === 'number' && Number.isFinite(actual) && actual > 0) return actual
  const est = point.estimatedCost
  return typeof est === 'number' && Number.isFinite(est) && est > 0 ? est : 0
}

/** ISO YYYY-MM-DD for a Date in UTC (the BFF keys days by UTC date). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Today's spend, matched by UTC date against the daily series. `now` is injected
 * so the pill and tests are deterministic; defaults to the wall clock.
 */
export function todaySpend(daily: UsageDailyPoint[], now: Date = new Date()): number {
  const today = isoDay(now)
  const point = daily.find((d) => d.day === today)
  return point ? pointSpend(point) : 0
}

/**
 * Month-to-date spend: the sum of daily spend whose UTC day falls in the same
 * calendar month as `now`. Used for the monthly soft budget.
 */
export function monthToDateSpend(daily: UsageDailyPoint[], now: Date = new Date()): number {
  const prefix = isoDay(now).slice(0, 7) // YYYY-MM
  let sum = 0
  for (const d of daily) {
    if (d.day.slice(0, 7) === prefix) sum += pointSpend(d)
  }
  return sum
}

/**
 * The rolling daily-average spend across the period's days that actually had
 * spend. Averaging only spend-bearing days keeps the "typical day" honest — a
 * long tail of quiet $0 days shouldn't drag the average toward zero and make a
 * real burn rate look tiny. Returns 0 when there's no spend at all.
 */
export function dailyAverageSpend(daily: UsageDailyPoint[]): number {
  let sum = 0
  let activeDays = 0
  for (const d of daily) {
    const s = pointSpend(d)
    if (s > 0) {
      sum += s
      activeDays += 1
    }
  }
  return activeDays === 0 ? 0 : sum / activeDays
}

/**
 * An APPROXIMATE $/hour for today, derived from today's spend spread across the
 * hours ELAPSED so far in the UTC day (min 1h so an early-morning spike doesn't
 * divide by a fraction and read as an absurd rate). This is deliberately rough —
 * the pill labels it "approx" and names the window — because agent-deck only
 * sees a daily rollup, not per-minute telemetry. Returns 0 when today is idle.
 */
export function approxHourlyRate(daily: UsageDailyPoint[], now: Date = new Date()): number {
  const spend = todaySpend(daily, now)
  if (spend <= 0) return 0
  const hoursElapsed = Math.max(1, now.getUTCHours() + now.getUTCMinutes() / 60)
  return spend / hoursElapsed
}

/** A cost-bearing per-model row: the honest spend + token total, cost-ordered. */
export interface ModelCostRow {
  model: string
  cost: number
  tokens: number
  /** Fraction of the largest row's cost (0..1), for a share bar. */
  share: number
  /** Fraction of total cost across all rows (0..1), for the "% of spend" label. */
  shareOfTotal: number
}

/**
 * Per-model spend, ordered by cost (largest first). Uses each model's
 * estimatedCost (the per-model breakdown carries no actualCost). Models with no
 * cost are dropped — a cost-share view of $0 rows is noise. Returns [] when
 * nothing was billed.
 */
export function costByModel(byModel: UsageModelBreakdown[]): ModelCostRow[] {
  const priced = byModel
    .map((m) => ({
      model: m.model,
      cost:
        typeof m.estimatedCost === 'number' &&
        Number.isFinite(m.estimatedCost) &&
        m.estimatedCost > 0
          ? m.estimatedCost
          : 0,
      tokens: m.inputTokens + m.outputTokens,
    }))
    .filter((m) => m.cost > 0)
  if (priced.length === 0) return []
  const max = Math.max(...priced.map((m) => m.cost))
  const total = priced.reduce((acc, m) => acc + m.cost, 0)
  return priced
    .sort((a, b) => b.cost - a.cost)
    .map((m) => ({
      ...m,
      share: max > 0 ? m.cost / max : 0,
      shareOfTotal: total > 0 ? m.cost / total : 0,
    }))
}

/**
 * The single dominant model by cost when its share is "most of the spend"
 * (>= the given fraction of total, default 60%) AND total spend is non-trivial.
 * Drives the gentle efficiency nudge ("Most spend is Opus — try Sonnet"); we
 * only nudge when one model clearly dominates, never on a balanced spread.
 * Returns null when there's no clear leader or spend is below the floor.
 */
export function dominantCostModel(
  byModel: UsageModelBreakdown[],
  options: { minTotal?: number; minShare?: number } = {},
): ModelCostRow | null {
  const { minTotal = 1, minShare = 0.6 } = options
  const rows = costByModel(byModel)
  if (rows.length === 0) return null
  const total = rows.reduce((acc, m) => acc + m.cost, 0)
  if (total < minTotal) return null
  const leader = rows[0]
  if (!leader || leader.shareOfTotal < minShare) return null
  return leader
}

/** Convenience: today's spend straight off a full summary (or 0 when absent). */
export function summaryTodaySpend(
  summary: UsageSummary | undefined,
  now: Date = new Date(),
): number {
  return summary ? todaySpend(summary.daily, now) : 0
}
