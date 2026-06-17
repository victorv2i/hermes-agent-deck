/**
 * Shared error / empty state primitives — the ONE vocabulary every surface uses
 * for "couldn't load" and "nothing here" moments.
 *
 * Before this, each surface hand-rolled its own tile (circle vs rounded-square,
 * size-10 vs size-11) and — worse — Usage/ErrorBoundary/NotFound shipped raw
 * sky-blue `bg-primary` retry buttons, violating accent governance (the action accent = primary
 * action / live state ONLY, never a recovery affordance buried in an error card).
 *
 * These converge on a single look: a `size-11 rounded-xl` accent-free tile + a
 * Lucide LINE icon + title + optional description + an action. The retry action
 * is a `<Button variant="outline">` so it never reaches for the action accent.
 */
import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type StatusTone = 'neutral' | 'destructive'

interface StatusBlockProps {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  tone: StatusTone
  action?: ReactNode
  className?: string
  role?: 'alert' | 'status'
}

/** The shared skeleton both ErrorState and EmptyState render. */
function StatusBlock({
  icon: Icon,
  title,
  description,
  tone,
  action,
  className,
  role,
}: StatusBlockProps) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <div
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description != null ? descriptionId : undefined}
      className={cn(
        'ad-surface flex min-w-0 flex-col items-center gap-3 rounded-xl bg-card px-6 py-12 text-center',
        className,
      )}
    >
      <span
        data-slot="state-icon"
        aria-hidden
        className={cn(
          'grid size-11 place-items-center rounded-xl border border-border shadow-sm',
          tone === 'destructive'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted/40 text-muted-foreground shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_6%,transparent)]',
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="max-w-full space-y-1">
        <p id={titleId} className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {title}
        </p>
        {description != null && (
          <p
            id={descriptionId}
            className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
          >
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

export interface ErrorStateProps {
  /** A Lucide LINE icon for the tile (never an emoji). */
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** When provided, renders a governed outline "Retry" action. */
  onRetry?: () => void
  /** Override the retry label (defaults to "Retry"). */
  retryLabel?: string
  className?: string
}

/** "Couldn't load X" — destructive-toned tile + an outline retry (never the action accent). */
export function ErrorState({
  icon,
  title,
  description,
  onRetry,
  retryLabel = 'Retry',
  className,
}: ErrorStateProps) {
  return (
    <StatusBlock
      icon={icon}
      title={title}
      description={description}
      tone="destructive"
      role="alert"
      className={className}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  )
}

export interface EmptyStateProps {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** Optional custom action node (e.g. a link or button). */
  action?: ReactNode
  className?: string
}

/** "Nothing here yet" — neutral-toned tile + an optional action. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <StatusBlock
      icon={icon}
      title={title}
      description={description}
      tone="neutral"
      action={action}
      className={className}
    />
  )
}
