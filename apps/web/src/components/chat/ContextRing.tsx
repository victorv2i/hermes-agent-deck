import { cn } from '@/lib/utils'
import { formatTokens } from '@/lib/format'

/**
 * A small SVG ring reporting how much context the conversation has consumed.
 *
 * HONESTY (T2.10): the hermes dashboard's `/api/chat/model-state` exposes no
 * per-model context-window size, so we cannot compute a truthful "% used".
 * Rather than divide by a fictional fixed 200k and render a precise-looking
 * (but wrong) percentage, this component has two modes:
 *
 *  - **estimate** — only when a real `limit` is supplied (the active model's
 *    context window from stock `/api/model/info`): a true `tokens / limit`
 *    fraction, an arc that tints danger past ~90%, and a plain-language "About
 *    N% of memory used" label. Still worded as an estimate — the token figure
 *    is the latest run's usage, not a byte-exact accounting.
 *  - **approximate** — the reality today (no `limit`): a calm NEUTRAL arc whose
 *    length grows on a log scale purely as an ambient "context is filling"
 *    cue — never claimed as a proportion — and an honest "≈N tokens in context
 *    (approximate)" label. No percentage is shown.
 *
 * Renders nothing until there is a token count to report.
 */
export function ContextRing({
  tokens,
  limit,
  className,
}: {
  /** Tokens consumed so far (e.g. the latest turn's total_tokens). */
  tokens: number
  /** The model's real context window, when known. Omit for the honest
   * approximate mode (no precise percentage is shown). */
  limit?: number
  className?: string
}) {
  if (!Number.isFinite(tokens) || tokens <= 0) return null

  const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
  const r = 7
  const circumference = 2 * Math.PI * r

  if (hasLimit) {
    const pct = Math.max(0, Math.min(1, tokens / limit))
    const danger = pct >= 0.9
    // Plain language, honestly hedged: the figure is an estimate (the latest
    // run's token usage against the model's real context window).
    const label = `About ${Math.round(pct * 100)}% of memory used (roughly ${formatTokens(
      tokens,
    )} of ${formatTokens(limit)} tokens)`
    return (
      <Ring
        label={label}
        approx={false}
        fraction={pct}
        dash={circumference * pct}
        circumference={circumference}
        r={r}
        strokeClass={danger ? 'stroke-destructive' : 'stroke-primary'}
        className={className}
      />
    )
  }

  // Honest approximate mode: a neutral arc on a log scale (~1k → small, ~100k →
  // most of the ring) that is an ambient cue ONLY, never a claimed proportion.
  const ambient = Math.max(0.06, Math.min(0.92, Math.log10(tokens) / 5))
  const label = `≈${formatTokens(tokens)} tokens in context (approximate)`
  return (
    <Ring
      label={label}
      approx
      dash={circumference * ambient}
      circumference={circumference}
      r={r}
      strokeClass="stroke-foreground/45"
      className={className}
    />
  )
}

function Ring({
  label,
  approx,
  fraction,
  dash,
  circumference,
  r,
  strokeClass,
  className,
}: {
  label: string
  approx: boolean
  fraction?: number
  dash: number
  circumference: number
  r: number
  strokeClass: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="context-ring"
      data-approx={approx ? 'true' : 'false'}
      {...(fraction !== undefined ? { 'data-fraction': fraction.toFixed(3) } : {})}
      className={cn('grid size-5 place-items-center', className)}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90">
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          strokeWidth="2.5"
          className="stroke-foreground/15"
        />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={cn('transition-all duration-250', strokeClass)}
        />
      </svg>
    </span>
  )
}
