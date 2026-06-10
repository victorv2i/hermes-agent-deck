/**
 * Budget alerting — the pure decision of WHEN to warn, plus a tiny
 * once-per-breach session latch.
 *
 * On each usage poll the App asks: given the current spend and the user's soft
 * caps, should we raise a calm warning toast? We must warn at most ONCE per
 * breach per session — a 60s poll must not re-toast every minute while spend
 * sits above the cap. The latch keys on the period (the literal `daily` /
 * `monthly` cap value) + the period bucket (today's date / this month) so:
 *   - raising the cap, then breaching the new cap, warns again (new key);
 *   - a new day / month re-arms the daily / monthly warning (new bucket);
 *   - staying above the same cap on the same day stays silent after the first.
 *
 * Pure + injectable (`now`) so the threshold behaviour is fully unit-tested; the
 * App owns the side effect (the toast) and the session-scoped latch instance.
 */
import type { UsageDailyPoint } from '@/features/usage/types'
import { isoDay, monthToDateSpend, todaySpend } from '@/features/usage/burnRate'
import type { Budget } from './budgetStore'

export type BudgetPeriod = 'daily' | 'monthly'

/** A full-month window — enough days to cover month-to-date on any calendar day. */
const MONTHLY_WINDOW_DAYS = 30

/**
 * How many days of usage the watcher must fetch to evaluate the current caps. A
 * monthly cap is checked against month-to-date, so the series must span the
 * whole month (a 1-day window would only ever return today's row, leaving the
 * monthly sum blind to every earlier day). A daily-only / unset budget needs
 * just today.
 */
export function usageWindowDays(budget: Budget): number {
  return budget.monthly !== null ? MONTHLY_WINDOW_DAYS : 1
}

export interface BudgetBreach {
  period: BudgetPeriod
  /** The current spend in the breached window (USD). */
  spend: number
  /** The cap that was crossed (USD). */
  cap: number
  /**
   * A stable identity for this breach instance: period · cap · bucket. The App
   * dedupes on this so one breach warns once per session, but a changed cap or a
   * new day/month re-arms.
   */
  key: string
}

/**
 * The set of breaches given current daily series + caps. Daily compares today's
 * spend to the daily cap; monthly compares month-to-date to the monthly cap. An
 * unset cap (null) never breaches. Returns [] when nothing is over.
 */
export function detectBreaches(
  daily: UsageDailyPoint[],
  budget: Budget,
  now: Date = new Date(),
): BudgetBreach[] {
  const out: BudgetBreach[] = []
  const dayBucket = isoDay(now)
  const monthBucket = dayBucket.slice(0, 7)

  if (budget.daily !== null) {
    const spend = todaySpend(daily, now)
    if (spend > budget.daily) {
      out.push({
        period: 'daily',
        spend,
        cap: budget.daily,
        key: `daily:${budget.daily}:${dayBucket}`,
      })
    }
  }
  if (budget.monthly !== null) {
    const spend = monthToDateSpend(daily, now)
    if (spend > budget.monthly) {
      out.push({
        period: 'monthly',
        spend,
        cap: budget.monthly,
        key: `monthly:${budget.monthly}:${monthBucket}`,
      })
    }
  }
  return out
}

/**
 * Filter detected breaches down to the ones NOT yet warned, recording the ones
 * returned into the latch so a later poll won't repeat them. Mutates the passed
 * `seen` set (the App holds one per session). Pure aside from that set write, so
 * the dedup contract is directly testable.
 */
export function pickUnwarnedBreaches(breaches: BudgetBreach[], seen: Set<string>): BudgetBreach[] {
  const fresh: BudgetBreach[] = []
  for (const b of breaches) {
    if (seen.has(b.key)) continue
    seen.add(b.key)
    fresh.push(b)
  }
  return fresh
}
