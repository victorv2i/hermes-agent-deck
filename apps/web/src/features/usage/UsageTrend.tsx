/**
 * UsageTrend — a per-day token trend as a stacked bar chart (input + output),
 * hand-rolled in SVG-free divs (no chart lib in the workspace). Both series are
 * decorative magnitude, not actions, so neither spends the reserved --primary
 * accent: output uses --chart-3, input a quieter --chart-2. Calm but legible:
 * subtle horizontal gridlines, a compact y-axis scale, denser x-axis labels,
 * and a per-bar tooltip that tracks the active day.
 *
 * Accessibility (T2.9): each bar is a real focusable button carrying a full
 * per-day `aria-label` (date · input · output · sessions), so the rich figures
 * that were previously locked behind mouse-hover are now reachable by keyboard
 * and touch. The tooltip surfaces on focus as well as hover.
 */
import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatDayFull,
  formatDayLabel,
  formatTokens,
  formatTokensFull,
  niceAxisMax,
} from './format'
import type { UsageDailyPoint } from './types'

export interface UsageTrendProps {
  daily: UsageDailyPoint[]
}

const CHART_HEIGHT = 184
const MIN_BAR = 2
/** Target count of x-axis ticks; we thin labels to roughly this many. */
const X_TICKS = 6

/** A full spoken label for one bar — the hover figures, made reachable. */
function barLabel(point: UsageDailyPoint): string {
  return `${formatDayFull(point.day)}: ${formatTokensFull(point.inputTokens)} input, ${formatTokensFull(
    point.outputTokens,
  )} output tokens, ${point.sessions} ${point.sessions === 1 ? 'session' : 'sessions'}`
}

export function UsageTrend({ daily }: UsageTrendProps) {
  const [hover, setHover] = useState<number | null>(null)

  const max = useMemo(
    () => Math.max(1, ...daily.map((d) => d.inputTokens + d.outputTokens)),
    [daily],
  )
  // Bars and gridlines scale against a clean rounded ceiling (991.9K → 1M) so
  // the y-axis ticks are round numbers; `max` stays the honest data peak for
  // the aria summary.
  const axisMax = niceAxisMax(max)

  // Indexes of the days that should show an x-axis label — first, last, and an
  // even spread between, so dense periods (30d) stay uncrowded but readable.
  const labelIndexes = useMemo(() => {
    const n = daily.length
    if (n === 0) return new Set<number>()
    if (n <= X_TICKS) return new Set(daily.map((_, i) => i))
    const step = Math.max(1, Math.round((n - 1) / (X_TICKS - 1)))
    const set = new Set<number>()
    for (let i = 0; i < n; i += step) set.add(i)
    set.add(n - 1)
    return set
  }, [daily])

  if (daily.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token trend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-10 text-center text-sm text-muted-foreground">
            No usage recorded in this period.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Three evenly-spaced gridlines (0 / 50% / 100% of the rounded axis ceiling)
  // for a sense of scale without clutter. Labels are humanized token counts.
  const gridlines = [1, 0.5, 0]

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>Token trend</CardTitle>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <LegendDot className="bg-[var(--chart-2)]" label="Input" />
          <LegendDot className="bg-[var(--chart-3)]" label="Output" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative flex gap-3">
          {/* Y-axis scale — peak / mid / zero, right-aligned against the plot. */}
          <div
            className="flex w-9 shrink-0 flex-col justify-between py-px text-right text-[11px] text-muted-foreground tabular-nums"
            style={{ height: CHART_HEIGHT }}
            aria-hidden
          >
            {gridlines.map((g) => (
              <span key={g} className="-translate-y-[0.4em] leading-none">
                {g === 0 ? '0' : formatTokens(axisMax * g)}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            {/* Gridlines sit behind the bars. */}
            <div
              className="pointer-events-none absolute inset-0 flex flex-col justify-between"
              style={{ height: CHART_HEIGHT }}
              aria-hidden
            >
              {gridlines.map((g) => (
                <div key={g} className="h-px w-full bg-border" />
              ))}
            </div>

            <div
              className="relative flex items-end gap-[3px]"
              style={{ height: CHART_HEIGHT }}
              role="group"
              aria-label={`Daily token usage over ${daily.length} days, peak ${formatTokensFull(
                max,
              )} tokens. Each bar is focusable for its day's figures.`}
            >
              {daily.map((d, i) => {
                const total = d.inputTokens + d.outputTokens
                const totalH = total > 0 ? Math.max(MIN_BAR, (total / axisMax) * CHART_HEIGHT) : 0
                const inputH = total > 0 ? (d.inputTokens / total) * totalH : 0
                const outputH = totalH - inputH
                const active = hover === i
                const dim = hover !== null && !active
                return (
                  <button
                    key={d.day}
                    type="button"
                    aria-label={barLabel(d)}
                    className="group/bar flex min-w-0 flex-1 cursor-default flex-col justify-end self-stretch rounded-[3px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover((h) => (h === i ? null : h))}
                  >
                    <div
                      className="flex flex-col justify-end overflow-hidden rounded-[3px] transition-[opacity,transform] duration-150 motion-reduce:transition-none"
                      style={{
                        height: totalH || MIN_BAR,
                        opacity: total === 0 ? 0.25 : dim ? 0.5 : 1,
                      }}
                    >
                      {total === 0 ? (
                        <div className="w-full bg-border" style={{ height: MIN_BAR }} />
                      ) : (
                        <>
                          {outputH > 0 ? (
                            <div
                              className="w-full bg-[var(--chart-3)]"
                              style={{ height: outputH }}
                            />
                          ) : null}
                          {inputH > 0 ? (
                            <div
                              className="w-full bg-[var(--chart-2)]"
                              style={{ height: Math.max(MIN_BAR, inputH) }}
                            />
                          ) : null}
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* X-axis labels — thinned to ~6 ticks, aligned under their bars. */}
            <div className="mt-2 flex gap-[3px] text-[11px] text-muted-foreground tabular-nums">
              {daily.map((d, i) => (
                <span key={d.day} className="min-w-0 flex-1 text-center">
                  {labelIndexes.has(i) ? formatDayLabel(d.day) : ' '}
                </span>
              ))}
            </div>
          </div>

          {hover !== null && daily[hover] ? <Tooltip point={daily[hover]} /> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function Tooltip({ point }: { point: UsageDailyPoint }) {
  const total = point.inputTokens + point.outputTokens
  return (
    <div
      role="status"
      className="ad-surface pointer-events-none absolute top-0 right-0 z-10 rounded-lg bg-popover px-3 py-2 text-xs shadow-lg"
    >
      <div className="font-medium text-foreground">{formatDayFull(point.day)}</div>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 tabular-nums">
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-[var(--chart-2)]" aria-hidden />
          Input
        </dt>
        <dd className="text-right text-foreground">{formatTokensFull(point.inputTokens)}</dd>
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-[var(--chart-3)]" aria-hidden />
          Output
        </dt>
        <dd className="text-right text-foreground">{formatTokensFull(point.outputTokens)}</dd>
        <dt className="text-muted-foreground">Total</dt>
        <dd className="text-right font-medium text-foreground">{formatTokensFull(total)}</dd>
        <dt className="text-muted-foreground">Sessions</dt>
        <dd className="text-right text-foreground">{point.sessions}</dd>
      </dl>
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-2 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  )
}
