import { AlertTriangle, Info, XCircle } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * StatusDot — the ONE governed status-dot primitive. Extracted so "live /
 * connected / degraded" reads IDENTICALLY across every surface (the header
 * ConnectionDot, Kanban's live dot, Home's fleet dots + ActiveRecentlyBand, and
 * AgentDetail's gateway/env facts) instead of each re-inventing its own colors +
 * shapes.
 *
 * Color governance (design-language §2 — the SPINE):
 *  - `tone` maps to a SEMANTIC token, NEVER the `--primary` action accent:
 *    ok → success · info → info · warn → warning · error → destructive ·
 *    idle → foreground-tertiary.
 *  - The ONE sanctioned exception is `live`: a genuine LIVE DATA-STREAM dot may
 *    carry the `--primary` accent, because the spine reserves the action accent for "PRIMARY
 *    ACTION + LIVE/ACTIVE state." This is opt-in and pairs with `pulse`. It is
 *    the ONLY place a status dot is the action accent — and it is documented here so the
 *    canonical mapping is unambiguous.
 *
 * The canonical "connected vs live" decision (the header-green-vs-Kanban-sky-blue
 * clash): a gateway/connection being *connected* is a SEMANTIC STATUS → `ok`
 * (success), shown as a calm green dot. A *live data stream* (Kanban's board
 * socket actively pushing updates) is the sanctioned `live` accent pulse. They
 * are different concepts and now render with the same primitive but the correct
 * governed treatment for each.
 *
 * Colorblind a11y: the alerting tones (info / warn / error) are NOT color-only —
 * each renders a distinct SHAPE glyph (info-circle / triangle / x-circle),
 * mirroring the original ActiveRecentlyBand markers, so the state is legible at a
 * glance and to a colorblind operator, and never conflated with the live accent.
 * `ok` and `idle` stay calm plain round dots. A `label` is always announced to
 * assistive tech.
 */

export type StatusTone = 'ok' | 'info' | 'warn' | 'error' | 'idle'

/** tone → semantic foreground class (for shape glyphs) + bg class (for round dots). */
const TONE: Record<StatusTone, { fg: string; bg: string; shape: ReactNode | null }> = {
  // Calm round dots — no shape glyph (the quiet healthy/neutral baselines).
  ok: { fg: 'text-success', bg: 'bg-success', shape: null },
  idle: { fg: 'text-foreground-tertiary', bg: 'bg-foreground-tertiary', shape: null },
  // Alerting tones — a SHAPE cue, not a hue alone.
  info: { fg: 'text-info', bg: 'bg-info', shape: <Info className="size-3" aria-hidden /> },
  warn: {
    fg: 'text-warning',
    bg: 'bg-warning',
    shape: <AlertTriangle className="size-3" aria-hidden />,
  },
  error: {
    fg: 'text-destructive',
    bg: 'bg-destructive',
    shape: <XCircle className="size-3" aria-hidden />,
  },
}

export interface StatusDotProps extends Omit<ComponentProps<'span'>, 'aria-label'> {
  /** The semantic state. Maps to a governed semantic token (never the accent). */
  tone: StatusTone
  /** Accessible status name, announced to screen readers (e.g. "Connected"). */
  label: string
  /**
   * A genuine LIVE DATA-STREAM dot — the ONE sanctioned `--primary` accent use
   * (overrides `tone`'s color). Pair with `pulse`. Leave off for plain status.
   */
  live?: boolean
  /** Motion-safe pulse (e.g. a live stream / connecting heartbeat). */
  pulse?: boolean
}

export function StatusDot({
  tone,
  label,
  live = false,
  pulse = false,
  className,
  // Defaults to the `img` role (a meaningful icon with a label). A consumer whose
  // dot announces a CHANGING state (e.g. the header ConnectionDot) may pass
  // `role="status"` to make it a polite live region instead.
  role = 'img',
  ...rest
}: StatusDotProps) {
  const t = TONE[tone]
  const hasShape = t.shape !== null
  const pulseCls = pulse ? 'motion-safe:animate-pulse' : ''

  return (
    <span
      // Default test id + tone hook; a consumer may override either via `...rest`
      // (e.g. ConnectionDot → data-testid="connection-dot" + data-status) so
      // existing test hooks stay green.
      data-testid="status-dot"
      data-tone={tone}
      role={role}
      aria-label={label}
      title={label}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      {...rest}
    >
      {hasShape ? (
        // Alerting tones: a shape glyph in the semantic hue (live can't apply —
        // a stream is never an alert, so a shape tone is always semantic).
        <span
          data-slot="status-dot-marker"
          data-testid="status-dot-shape"
          className={cn('inline-flex', t.fg, pulseCls)}
        >
          {t.shape}
        </span>
      ) : (
        // Calm round dot: the live accent when a sanctioned live stream, else the
        // semantic hue.
        <span
          data-slot="status-dot-marker"
          className={cn('inline-block size-1.5 rounded-full', live ? 'bg-primary' : t.bg, pulseCls)}
        />
      )}
    </span>
  )
}
