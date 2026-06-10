/**
 * BoardCard — one task tile on the board. Pure props in / `onOpen` out; the page
 * owns the open-drawer state. The tile itself is the clickable/keyboard surface
 * (Enter/Space open the drawer) and carries an optional MOVE control in its
 * corner. Because that control is itself interactive, the tile is a `role="button"`
 * div (not a `<button>`) — a button can't nest interactive children — while
 * keeping full keyboard parity via an explicit Enter/Space handler + tabindex.
 *
 * Anatomy (calm, token-driven, theme-safe): the title, an assignee chip + age, a
 * quiet metadata row (comments · link counts · child progress), an optional
 * warnings chip (semantic tint only), and — for a card in the RUNNING column —
 * the live worker/run strip so you can watch the work happen. A RUNNING worker is
 * a LIVE state, a sanctioned amber use (accent governance §2): the strip reads as
 * a faint amber-tinted panel with an amber spinning glyph.
 */
import { MessageSquare, GitBranch, Loader2, AlertTriangle, User, Square } from 'lucide-react'
import type { KanbanCard, KanbanMoveTarget } from '@agent-deck/protocol'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDuration, cardTitle } from './format'
import { MoveMenu } from './MoveMenu'

export interface BoardCardProps {
  card: KanbanCard
  onOpen: (id: string) => void
  /** Move this card to a new column (optimistic; the parent owns rollback). When
   *  omitted the move control is hidden (e.g. a read-only / unavailable board). */
  onMove?: (id: string, target: KanbanMoveTarget) => void
  /** True while THIS card's move is in flight (disables the move control). */
  movePending?: boolean
  /**
   * Stop THIS running card's worker (terminate its run). Called with the card id +
   * the live run id (from the enriched worker). Only offered for a running card that
   * actually carries a run id -- omitted otherwise, so the board never shows a Stop
   * that can't key a real run.
   */
  onStop?: (id: string, runId: number) => void
  /** True while THIS card's stop is in flight (shows a spinner, disables it). */
  stopPending?: boolean
}

/** The age to surface on a card: started age for running, else created age. */
function cardAgeLabel(card: KanbanCard): string | null {
  const age = card.age
  if (!age) return null
  if (card.column === 'running') return formatDuration(age.startedAgeSeconds)
  if (card.column === 'done') return formatDuration(age.timeToCompleteSeconds)
  return formatDuration(age.createdAgeSeconds)
}

export function BoardCard({
  card,
  onOpen,
  onMove,
  movePending = false,
  onStop,
  stopPending = false,
}: BoardCardProps) {
  const age = cardAgeLabel(card)
  const linkTotal = card.linkCounts.parents + card.linkCounts.children
  const warnTone =
    card.warnings?.highestSeverity === 'error' || card.warnings?.highestSeverity === 'critical'
      ? 'destructive'
      : 'warning'
  // The warnings data is a COUNT-only rollup (no per-rule detail crosses the BFF),
  // so the badge is an honest status indicator, not a gateway to detail that
  // doesn't exist. Its title states exactly what's known: the count + severity.
  const warnCount = card.warnings?.count ?? 0
  const warnSeverity = card.warnings?.highestSeverity
  const warnLabel = warnCount
    ? `${warnCount} ${warnCount === 1 ? 'warning' : 'warnings'}${
        warnSeverity ? ` (highest: ${warnSeverity})` : ''
      }`
    : ''

  function handleKeyDown(e: React.KeyboardEvent) {
    // Restore the native-button behaviour the div doesn't get for free: Enter/Space
    // open the drawer. (The move control stops propagation so it isn't shadowed.)
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(card.id)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(card.id)}
      onKeyDown={handleKeyDown}
      data-testid="kanban-card"
      data-card-id={card.id}
      className={cn(
        'ad-surface ad-surface-hover group/board-card relative w-full cursor-pointer rounded-[10px] bg-card px-3 py-2.5 text-left',
        'transition-colors focus-visible:ad-focus',
      )}
    >
      {/* Move control — top-right. It stays visible and touch-sized on narrow
          screens, then becomes hover/focus-revealed on denser desktop boards. */}
      {onMove ? (
        <div
          className={cn(
            'absolute right-1.5 top-1.5 opacity-100 transition-opacity',
            'md:opacity-0 md:group-hover/board-card:opacity-100 md:group-focus-within/board-card:opacity-100',
            movePending && 'opacity-100 md:opacity-100',
          )}
        >
          <MoveMenu
            current={card.column}
            disabled={movePending}
            onMove={(target) => onMove(card.id, target)}
          />
        </div>
      ) : null}

      <p
        data-testid="kanban-card-title"
        title={card.title}
        className={cn(
          'line-clamp-2 text-[13px] font-medium leading-snug text-foreground',
          onMove && 'pr-12 md:pr-7',
        )}
      >
        {cardTitle(card.title)}
      </p>

      {/* Assignee + age */}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        {card.assignee ? (
          <span
            className="inline-flex min-w-0 items-center gap-1"
            title={`Assigned to ${card.assignee}`}
          >
            <User className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{card.assignee}</span>
          </span>
        ) : (
          <span className="text-foreground-tertiary">Unassigned</span>
        )}
        {age ? (
          <span className="ml-auto shrink-0 tabular-nums text-foreground-tertiary">{age}</span>
        ) : null}
      </div>

      {/* Live worker strip — running cards only; a RUNNING worker is a LIVE state
          (a sanctioned amber use): a faint amber-tinted panel + amber glyph. When a
          live run id is present and onStop is wired, a quiet Stop control rides the
          strip so you can terminate the worker from the board itself (it stops
          propagation so it doesn't open the drawer). */}
      {card.column === 'running' && card.worker ? (
        <div
          data-testid="kanban-card-worker"
          className="mt-2 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] text-foreground"
        >
          <Loader2 className="size-3 shrink-0 text-primary motion-safe:animate-spin" aria-hidden />
          <span className="truncate">
            {card.worker.profile ? `${card.worker.profile} · ` : ''}
            {card.worker.status ?? 'running'}
          </span>
          {onStop && card.worker.id ? (
            <button
              type="button"
              data-testid="kanban-card-stop"
              aria-label="Stop this worker"
              title="Stop this worker"
              disabled={stopPending}
              onClick={(e) => {
                e.stopPropagation()
                if (card.worker?.id) onStop(card.id, card.worker.id)
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn(
                'ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-[6px] text-destructive md:size-5',
                'transition-colors hover:bg-destructive/15 disabled:opacity-60',
                'focus-visible:ad-focus',
              )}
            >
              {stopPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <Square className="size-2.5" aria-hidden />
              )}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Metadata row — quiet, neutral; only present when there's something to show. */}
      {(card.commentCount > 0 || linkTotal > 0 || card.progress || card.warnings) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-foreground-tertiary">
          {card.commentCount > 0 && (
            <span
              className="inline-flex items-center gap-1"
              title={`${card.commentCount} comments`}
            >
              <MessageSquare className="size-3" aria-hidden />
              {card.commentCount}
            </span>
          )}
          {linkTotal > 0 && (
            <span className="inline-flex items-center gap-1" title={`${linkTotal} linked tasks`}>
              <GitBranch className="size-3" aria-hidden />
              {linkTotal}
            </span>
          )}
          {card.progress && (
            <span className="tabular-nums" title="Child task progress">
              {card.progress.done}/{card.progress.total}
            </span>
          )}
          {warnCount > 0 && (
            <Badge
              variant={warnTone}
              data-testid="kanban-card-warnings"
              title={warnLabel}
              aria-label={warnLabel}
              className="h-4 gap-1 px-1.5 py-0 text-[10px]"
            >
              <AlertTriangle className="size-2.5" aria-hidden />
              <span aria-hidden>{warnCount}</span>
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
