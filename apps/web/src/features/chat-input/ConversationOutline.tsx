/**
 * Conversation outline (jump-list), PRESENTATIONAL.
 *
 * A calm, squared jump-list of the USER's own prompts in the current
 * conversation, so a long chat is navigable: click a prompt to scroll it into
 * view. It owns NO data: the ChatView agent derives the prompt list from the
 * rendered turns, tracks which one is in view, and scrolls on jump; this
 * component just renders the list and reports intent (jump, close).
 *
 * a11y: a labelled `navigation` landmark; each prompt is a button. The
 * in-view prompt is marked `aria-current` and reads with the sky-blue accent
 * (the one allowed accent use here, marking the user's place). Token-driven,
 * all themes; reduced-motion is respected (no transition the media query
 * ignores). LOCAL-ONLY.
 */
import { useEffect, useRef } from 'react'
import { ListTree, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One outline entry: a user prompt resolved to its turn id + a short label. */
export interface OutlineItem {
  /** The turn id (used to scroll the matching row into view). */
  id: string
  /** A one-line label for the prompt (already trimmed/collapsed by the caller). */
  label: string
}

export interface ConversationOutlineProps {
  /** The user prompts, in conversation order (the caller derives these). */
  items: readonly OutlineItem[]
  /** The id of the prompt currently in view, or null. Marks the user's place. */
  activeId: string | null
  /** Jump to a prompt (the caller scrolls its row into view). */
  onJump: (id: string) => void
  /** Close the outline (Esc / the × button). */
  onClose: () => void
  className?: string
}

/**
 * The outline panel. Auto-focuses its first control on mount so keyboard users
 * land inside it; the caller mounts/unmounts it to open/close.
 */
export function ConversationOutline({
  items,
  activeId,
  onJump,
  onClose,
  className,
}: ConversationOutlineProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Land focus on the close control on open so Esc / Tab is immediate and the
  // panel doesn't trap the reader's focus somewhere off-screen.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <nav
      aria-label="Conversation outline"
      onKeyDown={handleKeyDown}
      className={cn(
        // Squared, calm card matching the find bar's surface language.
        'ad-surface flex max-h-[60vh] w-60 flex-col rounded-xl border border-border bg-popover shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ListTree className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
        <span className="flex-1 text-[11px] font-medium tracking-wide text-foreground-tertiary uppercase">
          Your prompts
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close outline"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus motion-reduce:transition-none"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {items.length === 0 ? (
        // Honest empty state: a conversation with no user prompts yet (or one the
        // caller filtered to nothing) reads clearly rather than showing a blank box.
        <p className="px-3 py-3 text-[12px] text-muted-foreground">No prompts yet.</p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto p-1">
          {items.map((item, i) => {
            const current = item.id === activeId
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onJump(item.id)}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors motion-reduce:transition-none',
                    current
                      ? // The in-view prompt: the governed sky-blue accent marks the
                        // user's place (an allowed accent use).
                        'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'shrink-0 tabular-nums',
                      current ? 'text-primary' : 'text-foreground-tertiary',
                    )}
                  >
                    {i + 1}.
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </nav>
  )
}
