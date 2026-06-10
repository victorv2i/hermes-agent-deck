/**
 * Find-in-conversation overlay (⌘F) — PRESENTATIONAL.
 *
 * A calm in-transcript find bar: a search input, a match counter ("3 / 12"),
 * prev/next steppers, and a close button. It owns NO matching: the ChatView
 * agent computes `matches` over the rendered turns, tracks `activeIndex`, and
 * scrolls the active match into view; this component just renders the controls
 * and reports intent (query change, next/prev, close).
 *
 * Keyboard, from the input:
 *   - Enter         → next match
 *   - Shift+Enter   → previous match
 *   - Escape        → close
 *
 * a11y: a `role="search"` region with a labelled input and an `aria-live`
 * status so the match count is announced as it changes. Token-driven, all
 * themes; amber is reserved for the active control affordance only.
 * Reduced-motion is respected (no transition work that ignores the media query).
 * LOCAL-ONLY.
 */
import { useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FindInConversationProps {
  /** The current query text (controlled by the caller). */
  query: string
  /** The match positions the ChatView computed (its length is the total count). */
  matches: readonly unknown[]
  /** The active match index (0-based), or -1 when there is no active match. */
  activeIndex: number
  /** The query changed (the caller recomputes matches). */
  onQueryChange: (query: string) => void
  /** Step to the next match (wraps; Enter). */
  onNext: () => void
  /** Step to the previous match (wraps; Shift+Enter). */
  onPrev: () => void
  /** Close the overlay (Esc / the × button). */
  onClose: () => void
  className?: string
}

/**
 * The find bar. Auto-focuses + selects its input on mount so ⌘F → type is
 * immediate; the caller mounts/unmounts it to open/close.
 */
export function FindInConversation({
  query,
  matches,
  activeIndex,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
  className,
}: FindInConversationProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const total = matches.length
  const hasMatches = total > 0
  // 1-based position for humans; show 0 when there's no active match.
  const position = hasMatches && activeIndex >= 0 ? activeIndex + 1 : 0
  const countLabel = query.length === 0 ? '' : hasMatches ? `${position} / ${total}` : 'No matches'

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!hasMatches) return
      if (e.shiftKey) onPrev()
      else onNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      role="search"
      aria-label="Find in conversation"
      className={cn(
        'ad-surface flex items-center gap-1.5 rounded-xl border border-border bg-popover px-2 py-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in conversation..."
        aria-label="Find in conversation"
        className="h-11 w-44 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none sm:h-7"
      />
      <span
        aria-live="polite"
        aria-atomic="true"
        // The match counter is feedback the user is actively waiting on, so it
        // stays legible (`text-muted-foreground`) in every state — including the
        // "No matches" case, which must read clearly rather than fade out.
        className="min-w-[3.5rem] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground"
      >
        {countLabel}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasMatches}
          aria-label="Previous match"
          className="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none sm:size-7"
        >
          <ChevronUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMatches}
          aria-label="Next match"
          className="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none sm:size-7"
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close find"
          className="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus motion-reduce:transition-none sm:size-7"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
