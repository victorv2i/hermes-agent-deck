/**
 * StatCard – a single headline metric tile (e.g. Total tokens, Est. cost).
 * Uses the shared shadcn Card vocabulary (lifted border + top highlight via
 * `.ad-surface`), themed to the warm-void palette. The label is the canonical
 * 11px section label; the value is large, tabular, and neutral (no accent – accent
 * governance reserves the sky-blue accent for primary actions and live/active state).
 */
import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export interface StatCardProps {
  label: string
  value: string
  /** Optional smaller line beneath the value (e.g. exact token count). */
  sub?: ReactNode
  icon?: ReactNode
  /**
   * Optional one-line explanation of what the metric counts / how it's derived
   * (e.g. cost basis, what "cache + reasoning" sums). Surfaced as a small,
   * keyboard-reachable info affordance with a hover/title tooltip – so the
   * headline number doesn't have to carry the caveat inline (T3.9).
   */
  info?: string
}

export function StatCard({ label, value, sub, icon, info }: StatCardProps) {
  return (
    <Card className="ad-raised ad-surface-hover gap-2" size="sm">
      <CardContent className="flex flex-col gap-2">
        <div className="ad-section-label flex items-center gap-1.5">
          {icon ? <span className="shrink-0 text-muted-foreground/70">{icon}</span> : null}
          {/* Single line, always: labels are kept short and truncate rather than
              wrap, so every tile's big number sits on the same baseline. */}
          <span className="min-w-0 truncate">{label}</span>
          {info ? (
            <button
              type="button"
              // A non-actionable explainer: it carries the tooltip text on hover
              // (title) and announces what it's about to SRs. No popover – the
              // title + accessible name keep it dependency-free and robust.
              // (The title tooltip is hover/focus only; touch gets no tooltip.)
              // The ::before overlay gives the 14px glyph a 44px hit area
              // without growing the visual icon or the layout.
              title={info}
              aria-label={`About ${label}: ${info}`}
              className="relative ml-auto inline-grid shrink-0 place-items-center rounded-full text-muted-foreground/60 transition-colors before:absolute before:-inset-[15px] before:content-[''] hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:ad-focus"
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="font-heading text-2xl leading-none font-semibold tabular-nums text-foreground">
          {value}
        </div>
        {sub ? (
          <div className="text-xs leading-tight text-muted-foreground tabular-nums">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}
