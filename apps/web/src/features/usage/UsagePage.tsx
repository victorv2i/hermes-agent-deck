/**
 * UsagePage — the presentational Usage surface. Pure props in (data + period +
 * loading/error), callbacks out. The route component (UsageRoute) owns the query
 * and period state. Layout follows the design language: a calm header with the
 * title + period selector, headline stat cards, the per-day token trend, and the
 * per-model breakdown. Centered, generous whitespace.
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import { BarChart3, Brain, Coins, DollarSign, MessagesSquare, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { cn } from '@/lib/utils'
import { PeriodSelector } from './PeriodSelector'
import { StatCard } from './StatCard'
import { CacheHitTile } from './CacheHitTile'
import { UsageTrend } from './UsageTrend'
import { ModelBreakdown } from './ModelBreakdown'
import { ProviderBreakdown } from './ProviderBreakdown'
import { CostInsights } from './CostInsights'
import { resolveBillingMode } from './billingMode'
import { formatCost, formatTokens, formatTokensFull } from './format'
import type { UsagePeriod, UsageSummary } from './types'

export interface UsagePageProps {
  period: UsagePeriod
  onPeriodChange: (period: UsagePeriod) => void
  data?: UsageSummary
  isLoading: boolean
  isFetching: boolean
  error?: Error | null
  onRetry?: () => void
  /**
   * The active provider slug (from `/api/agent-deck/models` → `provider.id`).
   * A subscription/OAuth seat (e.g. `openai-codex`) reports a $0 cost pair even
   * when busy, so the cost tile is relabeled "Included in your subscription"
   * rather than the misleading "No billed cost".
   */
  providerId?: string | null
  /** Human label for the active provider (e.g. "OpenAI Codex"). */
  providerLabel?: string | null
  /**
   * Start a chat from the empty state. The route owns the navigate
   * (`navigate(CHAT_PATH)`, matching Home/History), so the empty-state CTA is a
   * router push — never an `<a href="/">` hard reload. Omitted → no CTA.
   */
  onStartChat?: () => void
}

export function UsagePage({
  period,
  onPeriodChange,
  data,
  isLoading,
  isFetching,
  error,
  onRetry,
  providerId,
  providerLabel,
  onStartChat,
}: UsagePageProps) {
  // Which breakdown the bottom section shows. Per-model is the default (the
  // historical view); per-provider rolls those same rows up by their recorded
  // billing_provider. Local UI state — the data is identical either way.
  const [breakdownBy, setBreakdownBy] = useState<'model' | 'provider'>('model')

  const totals = data?.totals
  const totalTokens = totals ? totals.inputTokens + totals.outputTokens : 0
  const estimatedCost = totals?.estimatedCost ?? 0
  const hasSpend = estimatedCost > 0
  // A loaded period with zero sessions AND zero tokens is a true "nothing yet"
  // (a fresh install, or a quiet window) — show a warm invitation, not a wall of
  // zeros or a blank screen. Missing data (no error, not loading) lands here too.
  const hasUsage = !!totals && (totals.sessions > 0 || totalTokens > 0)
  // The authoritative billing read: prefer the SERVER-derived mode (from the
  // recorded billing_provider on /api/analytics/models), falling back to the
  // active-provider + cost heuristic only when the server couldn't resolve it. A
  // subscription/OAuth seat with real tokens is `subscription` even at $0 cost.
  const mode = resolveBillingMode(data?.billingMode, data?.daily ?? [], providerId)
  const isSubscription = mode === 'subscription'
  // A zero cost while tokens WERE used isn't "no spend" — but WHY differs:
  //   subscription → covered by a flat plan (say "Included in your subscription").
  //   otherwise    → a provider with no rate card (local/free): "No billed cost".
  const unbilled = !hasSpend && totalTokens > 0 && !isSubscription

  // Keep the raw internal error (e.g. "session-token request failed: fetch
  // failed") available for diagnostics, but never render it: the user sees a
  // calm human sentence (below), the developer sees the plumbing in the console.
  if (error) {
    console.warn('[usage] failed to load:', error.message)
  }

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6 px-6 py-8">
      <PageHeader
        icon={BarChart3}
        title="Usage"
        subtitle={
          <>
            Token &amp; cost analytics over the last {period} days
            {isFetching && !isLoading ? <span className="ml-2 opacity-70">updating…</span> : null}
          </>
        }
        actions={<PeriodSelector value={period} onChange={onPeriodChange} disabled={isLoading} />}
        className="mb-0"
      />

      {error ? (
        <ErrorState
          icon={BarChart3}
          title="Couldn’t load usage"
          description="The hermes dashboard may be offline. Usage analytics live there."
          onRetry={onRetry}
        />
      ) : isLoading ? (
        <UsageSkeleton />
      ) : !hasUsage ? (
        <EmptyState
          icon={Sparkles}
          title="No usage yet"
          description="Token and cost analytics show up here after your agent runs. Start a conversation and your first numbers will land within this window."
          action={
            onStartChat ? (
              <Button size="sm" onClick={onStartChat}>
                <MessagesSquare className="size-3.5" />
                Start a chat
              </Button>
            ) : undefined
          }
        />
      ) : data ? (
        <>
          <section className="flex flex-col gap-3">
            {/* The one question a newcomer brings here ("what does this cost?")
                answered first, in a plain sentence. Mirrors the cost tile's
                billing flags exactly (subscription / unbilled / no spend), only
                reworded — never recomputed. */}
            <p className="text-sm text-muted-foreground" data-testid="cost-lead">
              {isSubscription && !hasSpend ? (
                <>
                  <span className="font-medium text-foreground">
                    Covered by your subscription{providerLabel ? ` (${providerLabel})` : ''}
                  </span>
                  , no extra cost in the last {period} days.
                </>
              ) : unbilled ? (
                <>
                  <span className="font-medium text-foreground">No billed cost</span> in the last{' '}
                  {period} days. This provider has no per-call pricing for these tokens.
                </>
              ) : hasSpend ? (
                <>
                  <span className="font-medium text-foreground">
                    {formatCost(estimatedCost)} estimated cost
                  </span>{' '}
                  in the last {period} days.
                </>
              ) : (
                <>No cost recorded in the last {period} days.</>
              )}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard
                label="Est. cost"
                value={(hasSpend && formatCost(estimatedCost)) || '—'}
                sub={
                  isSubscription && !hasSpend ? (
                    <span
                      className="text-muted-foreground/70"
                      title={`Your active provider${
                        providerLabel ? ` (${providerLabel})` : ''
                      } bills a flat subscription, not per call, so there's no per-request dollar amount. The work is counted in tokens.`}
                    >
                      Included in your subscription
                    </span>
                  ) : unbilled ? (
                    <span
                      className="text-muted-foreground/70"
                      title="These tokens have no rate card configured for their provider (e.g. a local or free model), so there is nothing to bill."
                    >
                      No billed cost on this provider
                    </span>
                  ) : !hasSpend ? (
                    <span className="text-muted-foreground/70">No spend yet</span>
                  ) : totals && totals.actualCost > 0 ? (
                    `${formatCost(totals.actualCost) ?? '—'} actual`
                  ) : (
                    'estimated'
                  )
                }
                icon={<DollarSign className="size-3.5" />}
                info="Estimated from each provider's configured rate card. Flat-subscription and local/unpriced models contribute nothing to per-call cost."
              />
              <StatCard
                label="Tokens"
                value={formatTokens(totalTokens)}
                sub={`${formatTokensFull(totalTokens)} total`}
                icon={<Coins className="size-3.5" />}
                info="Input + output tokens across all runs in this period."
              />
              <StatCard
                label="Sessions"
                value={(totals?.sessions ?? 0).toLocaleString('en-US')}
                sub={`${data.byModel.length} model${data.byModel.length === 1 ? '' : 's'}`}
                icon={<MessagesSquare className="size-3.5" />}
                info="Distinct agent sessions with activity in this period, across every source."
              />
              <StatCard
                label="Cache"
                value={formatTokens(
                  (totals?.cacheReadTokens ?? 0) + (totals?.reasoningTokens ?? 0),
                )}
                sub={`${formatTokens(totals?.cacheReadTokens ?? 0)} cache · ${formatTokens(
                  totals?.reasoningTokens ?? 0,
                )} reason`}
                icon={<Brain className="size-3.5" />}
                info="Cache + reasoning tokens. Cache-read tokens (reused context, often cheaper) plus reasoning tokens: a subset of the total, shown to explain where tokens went."
              />
              <CacheHitTile
                cacheReadTokens={totals?.cacheReadTokens ?? 0}
                inputTokens={totals?.inputTokens ?? 0}
              />
            </div>
          </section>

          {/* Cost-first cockpit deep-dive: a spend trend (with rolling average),
              cost share by model, and a gentle efficiency nudge. Leads the page
              because cost shock is the loudest real pain. */}
          <CostInsights
            daily={data.daily}
            byModel={data.byModel}
            providerId={providerId}
            providerLabel={providerLabel}
            billingMode={data.billingMode}
          />

          {/* Token analytics — the depth-on-demand half, below the cost view. */}
          <UsageTrend daily={data.daily} />

          {/* The same usage rows, viewed two ways: per-model (default) or rolled
              up per-provider by their recorded billing_provider. A small
              segmented toggle swaps the view; ModelBreakdown stays untouched. */}
          <section className="flex flex-col gap-3">
            <BreakdownToggle value={breakdownBy} onChange={setBreakdownBy} />
            {breakdownBy === 'provider' ? (
              <ProviderBreakdown byModel={data.byModel} />
            ) : (
              <ModelBreakdown byModel={data.byModel} />
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

const BREAKDOWN_OPTIONS: Array<{ key: 'model' | 'provider'; label: string }> = [
  { key: 'model', label: 'By model' },
  { key: 'provider', label: 'By provider' },
]

/**
 * Segmented toggle for the breakdown view (By model / By provider). Same shape +
 * accent rules as PeriodSelector: a hairline-bordered pill where the active
 * segment carries the amber `--primary` (the one place amber is right here — it's
 * an active/selected state), inactive segments stay muted. 44px touch target on
 * mobile, relaxed on desktop.
 *
 * a11y (I5): an ARIA radiogroup implementing the roving-tabindex pattern — only
 * the checked radio is in the tab order; ArrowLeft/ArrowRight (and Up/Down) move
 * selection with wrap-around, mirroring PeriodSelector's WAI-ARIA radio map.
 */
function BreakdownToggle({
  value,
  onChange,
}: {
  value: 'model' | 'provider'
  onChange: (next: 'model' | 'provider') => void
}) {
  // Refs to each radio button so an arrow keypress can move DOM focus to the
  // newly-selected segment (roving tabindex).
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])

  const selectAt = (index: number) => {
    const wrapped =
      ((index % BREAKDOWN_OPTIONS.length) + BREAKDOWN_OPTIONS.length) % BREAKDOWN_OPTIONS.length
    const next = BREAKDOWN_OPTIONS[wrapped]
    if (next === undefined) return
    onChange(next.key)
    // Move focus to the now-checked radio so the tab order follows selection.
    buttonsRef.current[wrapped]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectAt(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectAt(index - 1)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Breakdown grouping"
      className="inline-flex items-center gap-0.5 self-start rounded-[9px] border border-border bg-surface-2/60 p-0.5"
    >
      {BREAKDOWN_OPTIONS.map((opt, index) => {
        const active = opt.key === value
        return (
          <button
            key={opt.key}
            ref={(el) => {
              buttonsRef.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: only the checked radio is reachable via Tab; the
            // arrow keys traverse the rest.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'min-h-11 touch-manipulation rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none sm:min-h-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function UsageSkeleton() {
  // Mirror the real stat section (the cost lead sentence + five tiles, sm:3 /
  // lg:5) so the placeholder lands exactly where the loaded cards do — no
  // layout shift when the data arrives.
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="flex flex-col gap-3">
        <div className="h-5 w-72 max-w-full animate-pulse rounded-md bg-surface-2/60" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="ad-surface h-[82px] animate-pulse rounded-xl bg-surface-2/60" />
          ))}
        </div>
      </div>
      <div className="ad-surface h-[280px] animate-pulse rounded-xl bg-surface-2/60" />
      <div className="ad-surface h-[200px] animate-pulse rounded-xl bg-surface-2/60" />
    </div>
  )
}
