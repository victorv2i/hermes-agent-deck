/**
 * BoardColumn — one calm lane: a header (dot + label + count) over a vertical
 * stack of {@link BoardCard}s. The column is a labelled `region` (its header is
 * the accessible name) so a screen-reader user can jump lane-to-lane, and the
 * card list is a real list. Laid out as a fixed-width flex column so the board
 * scrolls horizontally on narrow screens.
 *
 * Moving a card is done via each card's MoveMenu (an honest column picker), not
 * drag-drop — the cards list stays a real list and the move is threaded down via
 * `onMoveCard` so the column itself carries no write logic.
 */
import { useId } from 'react'
import type { KanbanColumn, KanbanMoveTarget } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { BoardCard } from './BoardCard'
import { COLUMN_META, TONE_DOT_CLASS } from './columnMeta'

export interface BoardColumnProps {
  column: KanbanColumn
  onOpenCard: (id: string) => void
  /** Move a card to a new column (threaded to each card's MoveMenu). */
  onMoveCard?: (id: string, target: KanbanMoveTarget) => void
  /** The id of the card whose move is currently in flight (disables its menu). */
  movePendingId?: string | null
  /** Stop a running card's worker (threaded to each running card's Stop control). */
  onStopCard?: (id: string, runId: number) => void
  /** The id of the card whose stop is currently in flight. */
  stopPendingId?: string | null
  /** Optional layout override for responsive wrappers. */
  className?: string
  /** Test hook override for alternate responsive renderings. */
  testId?: string
}

export function BoardColumn({
  column,
  onOpenCard,
  onMoveCard,
  movePendingId,
  onStopCard,
  stopPendingId,
  className,
  testId = 'kanban-column',
}: BoardColumnProps) {
  const headingId = useId()
  const meta = COLUMN_META[column.name]
  const count = column.cards.length

  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      data-column={column.name}
      className={cn('flex w-[272px] shrink-0 flex-col gap-2.5', className)}
    >
      <header className="flex items-center gap-2 px-1">
        <span
          className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT_CLASS[meta.tone])}
          aria-hidden
        />
        <h2 id={headingId} className="ad-section-label text-foreground/80">
          {meta.label}
        </h2>
        <span className="ml-auto rounded-md bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </header>

      {count > 0 ? (
        <ul className="flex flex-col gap-2">
          {column.cards.map((card) => (
            <li key={card.id}>
              <BoardCard
                card={card}
                onOpen={onOpenCard}
                onMove={onMoveCard}
                movePending={movePendingId === card.id}
                onStop={onStopCard}
                stopPending={stopPendingId === card.id}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-[10px] border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-foreground-tertiary">
          {meta.label} has no cards yet.
        </div>
      )}
    </section>
  )
}
