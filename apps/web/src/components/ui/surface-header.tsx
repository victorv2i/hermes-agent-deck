import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * SurfaceHeader — the slim, full-width header for full-bleed TOOL surfaces
 * (Files, Terminal). It is the deliberate two-tier counterpart to {@link
 * PageHeader}: content pages (Settings, Models, Profiles, Usage) are scrollable
 * centered columns where PageHeader's 24px title + 36px tile + bottom margin
 * reads as a calm page title; tool surfaces are full-height working panels
 * (file tree/preview, live terminal) where that prominence would steal vertical
 * real estate and read as oversized chrome atop the tool. So tool surfaces get
 * this identical slim treatment instead — a neutral muted framed Lucide
 * tile, a 16px/medium title, an optional muted subtitle, and an optional
 * right-aligned slot (e.g. a connection dot) — sitting as a bordered top bar.
 *
 * Both share the neutral muted tile + heading face so the two tiers still read as
 * one family. This component exists so Files and Terminal stay byte-identical by
 * construction, not by copy-paste. See docs/design/design-language.md §"Surface
 * headers (two-tier)".
 */
export interface SurfaceHeaderProps {
  /** Lucide line icon (never emoji) — keeps headers glyph-consistent. */
  icon: LucideIcon
  title: string
  /** Optional quiet one-liner trailing the title (e.g. a workspace root path). */
  subtitle?: ReactNode
  /** Optional right-aligned slot (e.g. a connection dot). */
  actions?: ReactNode
  className?: string
}

export function SurfaceHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: SurfaceHeaderProps) {
  return (
    <header
      className={cn(
        'flex min-w-0 items-center gap-2 border-b border-border px-4 py-3.5 sm:gap-3 sm:px-6',
        className,
      )}
    >
      <span
        aria-hidden
        className="ad-surface grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground-tertiary"
      >
        <Icon className="size-[18px]" />
      </span>
      <h1 className="max-w-[45vw] shrink-0 truncate font-heading text-base font-medium tracking-tight text-foreground sm:max-w-[18rem]">
        {title}
      </h1>
      {subtitle ? (
        <span className="ml-1 hidden min-w-0 truncate text-xs text-foreground-tertiary sm:inline">
          {subtitle}
        </span>
      ) : null}
      {actions ? (
        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
