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
import {
  Inbox,
  ListTodo,
  CalendarClock,
  CircleCheck,
  Loader,
  Ban,
  Eye,
  CheckCheck,
  Archive,
  type LucideIcon,
} from 'lucide-react'
import type { KanbanColumn, KanbanColumnName, KanbanMoveTarget } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'
import { BoardCard } from './BoardCard'
import { COLUMN_META, TONE_DOT_CLASS } from './columnMeta'

/**
 * A quiet line glyph per lane for the crafted empty state, so an empty column
 * reads as a considered, labelled place ("nothing in To do yet") rather than a
 * thin header over a black void. Neutral/muted only; never the action accent.
 */
const COLUMN_EMPTY_ICON: Record<KanbanColumnName, LucideIcon> = {
  triage: Inbox,
  todo: ListTodo,
  scheduled: CalendarClock,
  ready: CircleCheck,
  running: Loader,
  blocked: Ban,
  review: Eye,
  done: CheckCheck,
  archived: Archive,
}

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
  const EmptyIcon = COLUMN_EMPTY_ICON[column.name]

  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      data-column={column.name}
      // self-stretch keeps lanes equal-height in the board row; the empty-state
      // placeholder stays compact (min-h-32) near the top rather than stretching
      // to fill the column, so an empty board reads as bounded cards, not a void.
      className={cn('flex w-[272px] shrink-0 flex-col gap-2.5 self-stretch', className)}
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
        // A crafted, centered empty lane: a quiet glyph tile + a calm line,
        // vertically centered in the column's height so an empty board reads as
        // a considered, waiting place rather than a header over a black void. The
        // hairline+highlight surface (ad-surface) and lifted-but-dashed frame keep
        // it inviting; neutral tones only, never the action accent.
        <div className="ad-surface flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border-dashed bg-surface-1/40 px-3 py-6 text-center">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg bg-muted/50 text-foreground-tertiary"
          >
            <EmptyIcon className="size-4" />
          </span>
          <p className="text-[11px] leading-snug text-foreground-tertiary">
            Nothing in {meta.label} yet
          </p>
        </div>
      )}
    </section>
  )
}
