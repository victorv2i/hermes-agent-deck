import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'

/**
 * A read-only "Configured on the <X> page →" linking card. The coherence rule:
 * Settings does NOT duplicate config a dedicated surface owns — it shows a calm,
 * honest pointer to where that config actually lives (Voice / Messaging / MCP /
 * the agent's Brain). Generalizes the shape of the original Active-model row so
 * every deferred domain reads identically.
 *
 * No editor here (read-only marker, no fake control); the only affordance is the
 * link out. Neutral glyph tile (identity/decoration is never the accent); the
 * governed amber is reserved for focus rings.
 */
export function DedicatedConfigLink({
  icon: Icon,
  title,
  description,
  to,
  linkLabel,
}: {
  icon: LucideIcon
  title: string
  description: string
  to: string
  linkLabel: string
}) {
  return (
    <Card className="ad-raised gap-0 py-0">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-muted text-muted-foreground"
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {title}
              <ReadOnlyMarker />
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>
        <Link
          to={to}
          className="ad-surface ad-surface-hover inline-flex shrink-0 items-center gap-1.5 rounded-md bg-card px-3 py-2 text-13 font-medium text-foreground transition-colors focus-visible:ad-focus"
        >
          {linkLabel}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  )
}

/** A quiet, non-accent marker that a config field can't be edited here. Lock glyph
 * + "Read-only" text so it's legible without color (colorblind-safe). Shared by
 * the dedicated-config links and the in-dump field rows. */
export function ReadOnlyMarker() {
  return (
    <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-foreground-tertiary uppercase">
      <Lock className="size-3" aria-hidden />
      Read-only
    </span>
  )
}
