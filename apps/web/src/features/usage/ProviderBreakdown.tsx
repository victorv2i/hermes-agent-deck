/**
 * ProviderBreakdown – per-PROVIDER token + cost rollup, the sibling of
 * ModelBreakdown. Same visual language (row + calm teal share bar + trailing
 * share-of-TOTAL %), only grouped by the provider Hermes attributed each model's
 * spend to (`billingProvider`) instead of by the model name.
 *
 * HONESTY (mirrors CostInsights' plan card + billingMode handling): a
 * flat-subscription / OAuth provider (e.g. `openai-codex`) reports a $0 cost pair
 * even when busy, so its row reads "Included in subscription" – NOT a misleading
 * "$0" – while still showing the real token total. A row with no recorded
 * attribution reads "Unattributed", never an invented provider name.
 *
 * The bar fill is the semantic teal (`--chart-2`), decorative magnitude – the sky-blue
 * `--primary` stays reserved for action / active state per the accent-governance
 * rules, exactly as in ModelBreakdown.
 */
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProviderBrandIcon } from '@/features/models/providerBrandIcons'
import { resolveProviderBrand } from '@/features/models/providerBrands'
import { formatCost, formatTokens, formatTokensFull } from './format'
import { groupByProvider } from './providerSpend'
import type { UsageModelBreakdown } from './types'

export interface ProviderBreakdownProps {
  byModel: UsageModelBreakdown[]
}

/** The human label for a provider row: a resolved brand name, or honest stand-ins. */
function providerLabel(provider: string, isUnattributed: boolean): string {
  if (isUnattributed) return 'Unattributed'
  return resolveProviderBrand(provider).label
}

export function ProviderBreakdown({ byModel }: ProviderBreakdownProps) {
  const rows = useMemo(() => groupByProvider(byModel), [byModel])

  return (
    <Card className="ad-raised">
      <CardHeader>
        <CardTitle>By provider</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No provider usage recorded in this period.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-4">
              {rows.map((p) => {
                const label = providerLabel(p.provider, p.isUnattributed)
                const cost = formatCost(p.cost)
                return (
                  <li key={p.provider || '__unattributed__'} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {/* Brand logo: decorative identity mark, aria-hidden; the
                            label carries a11y meaning. */}
                        <span
                          data-testid="provider-row-icon"
                          className="mt-px flex size-[14px] shrink-0 items-center justify-center text-muted-foreground"
                          aria-hidden
                        >
                          <ProviderBrandIcon provider={p.provider} size={13} />
                        </span>
                        <span
                          data-testid="provider-row-label"
                          className="truncate text-13 text-foreground"
                          title={label}
                        >
                          {label}
                        </span>
                        <span className="shrink-0 text-[11px] text-foreground-tertiary tabular-nums">
                          {p.modelCount} model{p.modelCount === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        <span
                          className="text-foreground"
                          title={`${formatTokensFull(p.tokens)} tokens`}
                        >
                          {formatTokens(p.tokens)}
                        </span>{' '}
                        tok
                        {/* HONESTY: a subscription/OAuth seat bills a flat plan, so
                            its $0 cost pair is NOT "no spend" – say so plainly
                            instead of rendering a misleading $0. A metered provider
                            shows its real cost; a genuine $0 (local/no rate card)
                            omits the cost segment entirely. */}
                        {p.isSubscription ? (
                          <>
                            <span className="mx-2 text-border-strong">·</span>
                            <span
                              className="text-muted-foreground/80"
                              title="This provider bills a flat subscription, not per call, so there's no per-request dollar amount. The work is counted in tokens."
                            >
                              Included in subscription
                            </span>
                          </>
                        ) : cost ? (
                          <>
                            <span className="mx-2 text-border-strong">·</span>
                            <span className="text-foreground">{cost}</span>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="ad-surface h-2 w-full overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-[var(--chart-2)] transition-[width] duration-200 motion-reduce:transition-none"
                          style={{ width: `${Math.max(2, p.share * 100)}%` }}
                        />
                      </div>
                      <span
                        data-testid="provider-share-pct"
                        className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
                      >
                        {Math.round(p.share * 100)}%
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p
              data-testid="provider-breakdown-legend"
              className="mt-4 text-[11px] text-foreground-tertiary"
            >
              % = share of total tokens in this period
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
