/**
 * PlanCard — rendered ONLY when a run emits a reasoning block.
 * Shows the raw reasoning text as a proposed step list BEFORE tool calls begin.
 *
 * Honesty rules:
 * - Only appears when segments.length > 0 (real reasoning.available events)
 * - Does NOT parse/number steps — displays the raw reasoning text honestly
 * - Renders nothing when segments are empty
 */
import { Brain } from 'lucide-react'

export function PlanCard({ segments }: { segments: string[] }) {
  if (segments.length === 0) return null

  return (
    <div
      data-testid="plan-card"
      aria-label="Agent plan"
      className="not-prose my-1.5 rounded-lg border border-border border-l-2 border-l-border bg-surface-1 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Brain className="size-3 shrink-0 text-foreground-tertiary" aria-hidden />
        {/* The card section title uses the canonical `.ad-section-label` utility
            (the single source of truth — design language §3) so "Plan" reads
            identically to the adjacent ToolCard's "Tool"/"Preview" labels rather
            than a lighter, tighter one-off. */}
        <span className="ad-section-label">Plan</span>
      </div>
      <div className="space-y-1">
        {segments.map((seg, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {seg}
          </p>
        ))}
      </div>
    </div>
  )
}
