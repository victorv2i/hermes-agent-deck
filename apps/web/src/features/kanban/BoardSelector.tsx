/**
 * BoardSelector — a tucked, calm picker for the multi-project board list. A
 * native `<select>` styled to the design tokens: it scales to any number of
 * boards, is fully keyboard-accessible for free, and stays quiet (it renders
 * nothing when there's only one board, so a single-board hermes sees no chrome).
 *
 * Read-only: switching the board just changes which snapshot the surface watches.
 */
import type { KanbanBoardSummary } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'

export interface BoardSelectorProps {
  boards: KanbanBoardSummary[]
  /** The selected slug (the active board when the user hasn't overridden). */
  value: string
  onChange: (slug: string) => void
  disabled?: boolean
}

export function BoardSelector({ boards, value, onChange, disabled }: BoardSelectorProps) {
  // Nothing to pick when there's a single board — keep the header quiet.
  if (boards.length <= 1) return null

  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className="sr-only">Board</span>
      <select
        aria-label="Board"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'min-h-11 rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5 text-xs font-medium text-foreground md:min-h-0',
          'focus-visible:ad-focus',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {boards.map((board) => (
          <option key={board.slug} value={board.slug}>
            {board.name} ({board.total})
          </option>
        ))}
      </select>
    </label>
  )
}
