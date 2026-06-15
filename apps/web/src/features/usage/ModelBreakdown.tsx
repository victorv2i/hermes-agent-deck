/**
 * ModelBreakdown — per-model token + cost rollup, sorted by total tokens. Each
 * row shows the model name, a calm teal share bar with a trailing share-of-TOTAL
 * %, the humanized token count, and the cost.
 *
 * HONESTY (INFO-ACC-1): the bar width and % shown is each model's share of the
 * GRAND TOTAL for the period — never share-of-peak (which forces the widest bar
 * to 100% and can make the sum exceed 100%). Share-of-peak would be an
 * info-accuracy lie (an impossible %). Grand-total ensures all %s add up to ≤100.
 *
 * The bar fill is the semantic teal (`--chart-2`), NOT amber: it's decorative
 * (a magnitude indicator, not an action/active state), so per the accent-
 * governance rules amber stays reserved for primary action / live state.
 *
 * VISUAL SCANNABILITY: each model row shows the vendor's brand mark (from
 * @lobehub/icons via ProviderBrandIcon) beside the model name — people read
 * logos faster than text. The mark is decorative (aria-hidden) and the model
 * name carries the accessible meaning.
 */
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProviderBrandIcon } from '@/features/models/providerBrandIcons'
import { formatCost, formatTokens, formatTokensFull } from './format'
import type { UsageModelBreakdown } from './types'

export interface ModelBreakdownProps {
  byModel: UsageModelBreakdown[]
}

/**
 * Derive the vendor slug from a model string. A model like `claude-opus-4` has no
 * slash prefix → vendor is inferred from the model name. A model like
 * `anthropic/claude-opus-4` → `anthropic`. Falls back to the raw model string.
 */
function vendorFromModel(model: string): string {
  const slash = model.indexOf('/')
  if (slash > 0) return model.slice(0, slash)
  // Common prefix heuristics for slash-free model names
  if (model.startsWith('claude')) return 'anthropic'
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini')) return 'google'
  if (model.startsWith('llama') || model.startsWith('meta')) return 'meta'
  if (model.startsWith('mistral') || model.startsWith('mixtral')) return 'mistral'
  if (model.startsWith('deepseek')) return 'deepseek'
  if (model.startsWith('qwen')) return 'qwen'
  if (model.startsWith('grok')) return 'xai'
  return model
}

export function ModelBreakdown({ byModel }: ModelBreakdownProps) {
  const rows = useMemo(() => {
    const withTotals = byModel.map((m) => ({ ...m, total: m.inputTokens + m.outputTokens }))
    // Use the GRAND TOTAL (sum of all models) as the denominator so each model's
    // share is truly its fraction of the period's total token spend. Share-of-peak
    // (the old max) would cap the widest bar at 100% and make the sum exceed 100%.
    const grandTotal = Math.max(
      1,
      withTotals.reduce((acc, m) => acc + m.total, 0),
    )
    return withTotals
      .slice()
      .sort((a, b) => b.total - a.total)
      .map((m) => ({ ...m, share: m.total / grandTotal }))
  }, [byModel])

  return (
    <Card>
      <CardHeader>
        <CardTitle>By model</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No model usage recorded in this period.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-4">
              {rows.map((m) => (
                <li key={m.model} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* Brand logo: decorative identity mark, aria-hidden; model name carries a11y meaning */}
                      <span
                        data-testid="model-row-icon"
                        className="mt-px flex size-[14px] shrink-0 items-center justify-center text-muted-foreground"
                        aria-hidden
                      >
                        <ProviderBrandIcon provider={vendorFromModel(m.model)} size={13} />
                      </span>
                      <span className="truncate font-mono text-13 text-foreground" title={m.model}>
                        {m.model}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      <span
                        className="text-foreground"
                        title={`${formatTokensFull(m.total)} tokens`}
                      >
                        {formatTokens(m.total)}
                      </span>{' '}
                      tok
                      {/* Omit the cost segment entirely for a genuine $0 (local
                          model / no pricing) rather than shipping a wall of zeros. */}
                      {(() => {
                        const cost = formatCost(m.estimatedCost)
                        return cost ? (
                          <>
                            <span className="mx-2 text-border-strong">·</span>
                            <span className="text-foreground">{cost}</span>
                          </>
                        ) : null
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="ad-surface h-2 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-[var(--chart-2)] transition-[width] duration-200 motion-reduce:transition-none"
                        style={{ width: `${Math.max(2, m.share * 100)}%` }}
                      />
                    </div>
                    <span
                      data-testid="model-share-pct"
                      className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
                    >
                      {Math.round(m.share * 100)}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {/* Legend: clarifies that % is share of total period tokens, never
                share-of-peak (which can exceed 100%). One line, muted. */}
            <p
              data-testid="model-breakdown-legend"
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
