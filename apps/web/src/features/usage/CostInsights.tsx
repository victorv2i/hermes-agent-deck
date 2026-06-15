/**
 * CostInsights — the cost-first half of the Usage surface (the cockpit's
 * deep-dive). Three calm, newcomer-legible blocks, NOT a wall of charts:
 *
 *   1. SPEND TREND — a per-day spend line with a dashed rolling daily-average
 *      reference, so "is today unusually expensive?" is answerable at a glance.
 *   2. COST SHARE BY MODEL — models ordered by spend, each with its share of the
 *      bill, so the expensive model is obvious.
 *   3. EFFICIENCY NUDGE — a gentle, optional info note, shown ONLY when spend is
 *      non-trivial AND one model dominates the bill ("Most spend is Opus on
 *      routine tasks — try Sonnet"). Calm, dismissible-by-ignoring, never nagging.
 *
 * Accent governance: spend magnitude bars/line use the semantic teal chart token
 * (decorative magnitude, not an action), the average reference is a quiet dashed
 * line, and the nudge is an INFO note — amber stays reserved for live action /
 * the budget-crossed state, never spent here.
 */
import { useMemo } from 'react'
import { Lightbulb, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCost, formatTokensFull } from '@/lib/format'
import { formatDayFull, formatDayLabel } from './format'
import { costByModel, dailyAverageSpend, dominantCostModel, pointSpend } from './burnRate'
import { resolveBillingMode, totalTokens } from './billingMode'
import type { UsageBillingMode, UsageDailyPoint, UsageModelBreakdown } from './types'

export interface CostInsightsProps {
  daily: UsageDailyPoint[]
  byModel: UsageModelBreakdown[]
  /**
   * The active provider slug (from `/api/agent-deck/models` → `provider.id`).
   * A known subscription/OAuth seat (e.g. `openai-codex`) reports a $0 cost pair
   * even when busy, so we read its token usage as a subscription rather than
   * "local / no billed cost". Omit it to fall back to cost-only inference.
   */
  providerId?: string | null
  /** Human label for the active provider (e.g. "OpenAI Codex"), for the plan card. */
  providerLabel?: string | null
  /**
   * The authoritative server-derived period billing mode (from the recorded
   * `billing_provider`). Preferred over the active-provider heuristic; omit or
   * pass `unknown` to fall back to it.
   */
  billingMode?: UsageBillingMode
}

/** Below this total spend we stay quiet — no efficiency nudge on pocket change. */
const NUDGE_MIN_SPEND = 1
/** A cheaper alternative to suggest when the named model dominates the bill. */
const CHEAPER_HINT: Record<string, string> = {
  opus: 'Sonnet',
  'gpt-5.5': 'a smaller model',
  'gpt-5.4': 'a smaller model',
}

function cheaperAlternative(model: string): string {
  const key = model.toLowerCase()
  for (const [needle, hint] of Object.entries(CHEAPER_HINT)) {
    if (key.includes(needle)) return hint
  }
  return 'a smaller model'
}

export function CostInsights({
  daily,
  byModel,
  providerId,
  providerLabel,
  billingMode,
}: CostInsightsProps) {
  const avg = useMemo(() => dailyAverageSpend(daily), [daily])
  const costRows = useMemo(() => costByModel(byModel), [byModel])
  const dominant = useMemo(
    () => dominantCostModel(byModel, { minTotal: NUDGE_MIN_SPEND }),
    [byModel],
  )
  const mode = useMemo(
    () => resolveBillingMode(billingMode, daily, providerId),
    [billingMode, daily, providerId],
  )
  const tokens = useMemo(() => totalTokens(daily), [daily])

  // Only render the cost-share + nudge blocks when there's real billed spend; an
  // unpriced (local-model) window shows just the trend, never empty $0 rows.
  const hasSpend = costRows.length > 0

  // On a subscription the provider isn't charging per call, so a per-day spend
  // line drawn from ESTIMATES would imply money left your account that didn't.
  // When work happened (tokens flowed) we swap the trend for an honest plan
  // token-usage card: the work IS counted, it's just covered by the plan.
  const showPlanCard = mode === 'subscription' && tokens > 0

  return (
    <div className="flex flex-col gap-6">
      {showPlanCard ? (
        <PlanUsageCard tokens={tokens} providerLabel={providerLabel} />
      ) : (
        <SpendTrend daily={daily} average={avg} />
      )}
      {hasSpend ? <CostShare rows={costRows} /> : null}
      {dominant ? <EfficiencyNudge model={dominant.model} share={dominant.shareOfTotal} /> : null}
    </div>
  )
}

/**
 * The subscription stand-in for the spend trend: work happened (tokens flowed)
 * but a flat subscription — not a per-call meter — covers it, so there's no
 * dollar line to draw. We make the honest TOKEN total the headline and say
 * plainly that it's included in the subscription, rather than the misleading
 * "No spend recorded" / "$0 billed". Tokens are decorative magnitude, not an
 * action, so this stays on neutral foreground type — no --primary, no amber.
 */
function PlanUsageCard({
  tokens,
  providerLabel,
}: {
  tokens: number
  providerLabel?: string | null
}) {
  const provider = typeof providerLabel === 'string' ? providerLabel.trim() : ''
  return (
    <Card data-testid="plan-usage-card">
      <CardHeader>
        <CardTitle>Plan usage</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-medium text-foreground tabular-nums">
          {formatTokensFull(tokens)} <span className="text-sm text-muted-foreground">tokens</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Included in your subscription{provider ? ` (${provider})` : ''}, not billed per call. Your
          provider charges a flat plan rather than per request, so the work is counted in tokens,
          not dollars, and there’s no per-day spend to chart.
        </p>
      </CardContent>
    </Card>
  )
}

/** A per-day spend line with a dashed rolling-average reference. */
function SpendTrend({ daily, average }: { daily: UsageDailyPoint[]; average: number }) {
  const points = useMemo(() => daily.map((d) => ({ day: d.day, spend: pointSpend(d) })), [daily])
  const max = useMemo(
    () => Math.max(average, ...points.map((p) => p.spend), 0.01),
    [points, average],
  )

  if (points.length === 0 || max <= 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spend trend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No spend recorded in this period.
          </p>
        </CardContent>
      </Card>
    )
  }

  const HEIGHT = 120
  const avgY = HEIGHT - (average / max) * HEIGHT
  const avgLabel = formatCost(average)
  // Indexes that get an x-axis label — first, last, and a midpoint — so a 30-day
  // window stays uncrowded.
  const lastIdx = points.length - 1
  const midIdx = Math.floor(lastIdx / 2)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>Spend trend</CardTitle>
        {avgLabel ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            avg <span className="text-foreground">{avgLabel}</span>/active day
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="relative" style={{ height: HEIGHT }} aria-hidden>
          {/* Dashed rolling-average reference line. */}
          {average > 0 ? (
            <div
              className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-muted-foreground/40"
              style={{ top: avgY }}
            />
          ) : null}
          <div className="flex h-full items-end gap-[3px]">
            {points.map((p) => {
              const h = p.spend > 0 ? Math.max(2, (p.spend / max) * HEIGHT) : 0
              return (
                <div
                  key={p.day}
                  className="min-w-0 flex-1 self-stretch"
                  style={{ display: 'flex', alignItems: 'flex-end' }}
                >
                  <div
                    className="w-full rounded-[3px] bg-[var(--chart-2)]"
                    style={{ height: h, opacity: p.spend > 0 ? 1 : 0 }}
                  />
                </div>
              )
            })}
          </div>
        </div>
        {/* A real, screen-reader-legible per-day table behind the visual line. */}
        <ul className="sr-only">
          {points.map((p) => (
            <li key={p.day}>
              {formatDayFull(p.day)}: {formatCost(p.spend) ?? '$0.00'}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{formatDayLabel(points[0]!.day)}</span>
          {points[midIdx] && midIdx !== 0 && midIdx !== lastIdx ? (
            <span>{formatDayLabel(points[midIdx]!.day)}</span>
          ) : null}
          {lastIdx > 0 ? <span>{formatDayLabel(points[lastIdx]!.day)}</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

/** Cost share by model — ordered by spend, each row showing its % of the bill. */
function CostShare({ rows }: { rows: ReturnType<typeof costByModel> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost by model</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-4">
          {rows.map((m) => {
            const cost = formatCost(m.cost)
            const pct = Math.round(m.shareOfTotal * 100)
            return (
              <li key={m.model} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-13 text-foreground" title={m.model}>
                    {m.model}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    <span className="text-foreground">{cost ?? '—'}</span>
                    <span className="mx-1.5 text-border-strong">·</span>
                    {pct}% of spend
                  </span>
                </div>
                <div className="ad-surface h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-[var(--chart-2)] transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${Math.max(2, m.share * 100)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

/** The gentle efficiency note. Calm INFO styling — informative, not alarming. */
function EfficiencyNudge({ model, share }: { model: string; share: number }) {
  const pct = Math.round(share * 100)
  const alt = cheaperAlternative(model)
  return (
    <div
      role="note"
      data-testid="efficiency-nudge"
      className="ad-surface flex items-start gap-3 rounded-xl bg-surface-1 px-4 py-3 text-sm"
    >
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-foreground-tertiary" aria-hidden />
      <p className="leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">
          {pct}% of your spend is {model}
        </span>
        . If a lot of that is routine work, routing those runs to {alt} can cut the bill with little
        loss in quality.
      </p>
      <TrendingUp
        className="mt-0.5 ml-auto hidden size-4 shrink-0 text-foreground-tertiary sm:block"
        aria-hidden
      />
    </div>
  )
}
