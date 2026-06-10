import { cn } from '@/lib/utils'

/**
 * A small neutral `#tag` chip shown on a session row. Tags are intentionally
 * NEUTRAL (no categorical color) — color is reserved for projects + the amber
 * action accent, so tags stay quiet metadata. Clicking filters the rail by that
 * tag; the active chip reads as pressed. Rendered as a real labelled button for
 * a11y (the parent row click is separate — the chip stops propagation).
 */
export function TagChip({
  tag,
  active = false,
  onClick,
}: {
  tag: string
  active?: boolean
  onClick?: (tag: string) => void
}) {
  const label = `#${tag}`
  if (!onClick) {
    return (
      <span
        className="inline-flex h-[18px] items-center rounded-[5px] bg-muted px-1.5 text-[10.5px] font-medium text-muted-foreground"
        data-active={active || undefined}
      >
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-label={active ? `Clear tag filter ${label}` : `Filter by tag ${label}`}
      aria-pressed={active}
      onClick={(e) => {
        // The chip lives inside a clickable row; don't let the click also open
        // the session.
        e.stopPropagation()
        onClick(tag)
      }}
      className={cn(
        'inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[10.5px] font-medium transition-colors',
        'focus-visible:ad-focus',
        active
          ? 'bg-foreground/15 text-foreground'
          : 'bg-muted text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
