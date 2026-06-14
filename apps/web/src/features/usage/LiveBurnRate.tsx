import { useNavigate } from 'react-router-dom'
import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCost } from '@/lib/format'
import { useBudget } from '@/features/budget/budgetStore'
import { usageWindowDays } from '@/features/budget/budgetAlert'
import { useUsage } from './useUsage'
import { approxHourlyRate, monthToDateSpend, todaySpend } from './burnRate'

/**
 * LiveBurnRate — a small, glanceable header pill showing TODAY's spend (the
 * loudest real user pain is cost shock; this surfaces it before the bill does).
 *
 * Calm by default: a muted "$4.32 today" chip. It turns to the WARNING token
 * (warm amber, NOT alarm-red) the moment a soft budget is crossed — a signal,
 * not a siren. Hover/tap reveals an approximate $/hr (honest about the window:
 * "spread over today"), and clicking jumps to the Usage surface for the full
 * picture.
 *
 * Self-contained: it reads its own days=1 usage query (polling ~60s) so today's
 * number stays live without a reload, and the budget store for the warning
 * threshold. Renders nothing until there's a real number to show (no "$0.00"
 * clutter on a fresh/idle install, and nothing while the first fetch is in
 * flight or errored — the pill is a bonus signal, never a blocker).
 */
export const BURN_RATE_POLL_MS = 60_000

export interface LiveBurnRateProps {
  /** Injected for deterministic tests; defaults to the wall clock. */
  now?: Date
}

export function LiveBurnRate({ now }: LiveBurnRateProps = {}) {
  const navigate = useNavigate()
  const { budget } = useBudget()
  // Fetch a window wide enough for the warning we'll compute: just today when
  // there's only a daily cap, but the whole month when a MONTHLY cap is set, so
  // month-to-date is real (a days=1 fetch made the monthly warning dead). The
  // cache is shared with the Usage surface / budget watcher by react-query's
  // `days` key, so this stays the cheapest possible read.
  const { data } = useUsage(usageWindowDays(budget), { refetchInterval: BURN_RATE_POLL_MS })

  const daily = data?.daily ?? []
  const at = now ?? new Date()
  const spend = todaySpend(daily, at)
  const label = formatCost(spend)

  // Nothing to show until there's a genuine, billed number today. A $0 / unbilled
  // / not-yet-loaded day yields null from formatCost — we render nothing rather
  // than a wall of zeros in the header.
  if (label === null) return null

  // A soft budget is "crossed" when today is over the daily cap OR month-to-date
  // is over the monthly cap. Warning is a state (amber), never destructive-red.
  const overDaily = budget.daily !== null && spend > budget.daily
  const monthSpend = budget.monthly !== null ? monthToDateSpend(daily, at) : 0
  const overMonthly = budget.monthly !== null && monthSpend > budget.monthly
  const warned = overDaily || overMonthly

  const hourly = approxHourlyRate(daily, at)
  const hourlyLabel = formatCost(hourly)
  // An honest hover line: name the window (it's a daily rollup spread over the
  // hours elapsed, not minute-level telemetry) and surface the crossed cap.
  const title = [
    `${label} spent today`,
    hourlyLabel ? `≈ ${hourlyLabel}/hr (today's spend so far, spread over elapsed hours)` : null,
    overDaily ? `Over your daily budget (cap ${formatCost(budget.daily!) ?? '—'})` : null,
    overMonthly
      ? `Over your monthly budget: ${formatCost(monthSpend) ?? '—'} this month (cap ${
          formatCost(budget.monthly!) ?? '—'
        })`
      : null,
    'Click to open Usage',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <button
      type="button"
      onClick={() => navigate('/usage')}
      data-testid="burn-rate-pill"
      data-warned={warned ? 'true' : undefined}
      aria-label={
        warned
          ? `${label} spent today, over your budget. Open Usage.`
          : `${label} spent today. Open Usage.`
      }
      title={title}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium tabular-nums transition-colors focus-visible:ad-focus',
        warned
          ? // WARNING token — warm amber, not alarm-red: a budget is a soft signal.
            'border-warning/40 bg-warning/12 text-warning hover:bg-warning/20'
          : // Calm at rest: a quiet, muted chip that doesn't compete for attention.
            'border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:bg-surface-2',
      )}
    >
      <Flame className="size-3" aria-hidden />
      <span>{label}</span>
      <span className="opacity-70">today</span>
    </button>
  )
}
