import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * PageHeader — the single, shared surface header used by every system/workspace
 * page (Models, Settings, Profiles, Usage, …) so they all read with the same
 * rhythm. A Lucide LINE icon (never emoji) in a neutral muted tile (the sky-blue
 * action accent never wears as decoration), the title at a consistent
 * size/weight, an optional muted subtitle, and an optional
 * right-aligned actions slot (e.g. a period selector). Carries its own bottom
 * margin so pages don't re-invent spacing.
 */
export interface PageHeaderProps {
  /** Lucide icon component (line icon). Required — keeps headers glyph-consistent. */
  icon: LucideIcon
  title: string
  /** Optional muted one-liner under the title. */
  subtitle?: ReactNode
  /** Optional right-aligned controls (selectors, buttons). */
  actions?: ReactNode
  className?: string
}

export function PageHeader({ icon: Icon, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex w-full min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className="ad-surface grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground-tertiary"
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="min-w-0 break-words font-heading text-2xl leading-tight font-medium tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="max-w-[60ch] text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-start gap-2 max-sm:[&_[data-slot=button]]:min-h-11 sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
