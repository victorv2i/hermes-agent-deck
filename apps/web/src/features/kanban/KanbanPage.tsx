/**
 * KanbanPage — the presentational Board surface. Pure props in (the board
 * snapshot + availability + live status + the selected board + the writable
 * callbacks) / callbacks out; the route ({@link KanbanRoute}) owns the queries,
 * the live socket, the mutations, and the open-drawer state.
 *
 * Layout (design-language): a slim full-bleed {@link SurfaceHeader} (this is a
 * dense, full-height TOOL surface, like Files/Terminal — not a centred content
 * page) with a live dot, the tucked board selector, a "New card" action, and an
 * EXPAND toggle; below it the horizontally-scrolling lane of 8 ordered columns
 * (inside {@link BoardScroller}, which carries the resting-scrollbar + edge-fade
 * scroll affordance).
 * Honest empty/loading states; the `available: false` case renders a calm
 * "enable the plugin" panel, never an error.
 *
 * EXPAND: the board is wide; on a narrow content column you can't see every lane
 * at once. The expand toggle lifts the SAME board lane into a full-viewport
 * overlay ({@link KanbanExpandedShell}) that breaks out of the shell's centred
 * column, with Esc / a clear Collapse control / keyboard + reduced-motion.
 *
 * The board is the live, non-archived view: the upstream `/board` omits archived
 * cards and the BFF never requests them, so there is no archived toggle (a control
 * that could only ever do nothing). Any stray `archived` column is filtered out.
 */
import { useEffect, useMemo, useState } from 'react'
import { KanbanSquare, Maximize2, Plus } from 'lucide-react'
import type {
  KanbanBoardResponse,
  KanbanBoardSummary,
  KanbanColumn,
  KanbanMoveTarget,
  KanbanStats,
} from '@agent-deck/protocol'
import { SurfaceHeader } from '@/components/ui/surface-header'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot'
import { BoardColumn } from './BoardColumn'
import { BoardScroller } from './BoardScroller'
import { BoardStatsBar } from './BoardStatsBar'
import { BoardSelector } from './BoardSelector'
import { KanbanExpandedShell } from './KanbanExpandedShell'
import type { KanbanLiveStatus } from './kanbanSocket'

export interface KanbanPageProps {
  /** The board snapshot envelope (available:false → enable-plugin empty state). */
  board?: KanbanBoardResponse
  /** The multi-board list for the selector (may be empty / one board). */
  boards: KanbanBoardSummary[]
  /** The board slug the surface is showing (active board when unset upstream). */
  selectedBoard: string
  onSelectBoard: (slug: string) => void
  /** Live socket status for the header dot. */
  liveStatus: KanbanLiveStatus
  /** Queue-health stats for the HUD strip (null/absent → the strip stays hidden). */
  stats?: KanbanStats | null

  isLoading: boolean
  isFetching: boolean
  error?: Error | null
  onRetry?: () => void

  onOpenCard: (id: string) => void

  /** Open the new-card composer. When omitted the action is hidden. */
  onCreateCard?: () => void
  /** Move a card to a new column (optimistic; the route owns rollback). */
  onMoveCard?: (id: string, target: KanbanMoveTarget) => void
  /** The id of the card whose move is in flight (disables its menu). */
  movePendingId?: string | null
  /** Stop a running card's worker from the board (terminate its run by run id). */
  onStopCard?: (id: string, runId: number) => void
  /** The id of the card whose stop is in flight. */
  stopPendingId?: string | null

  /** Whether the board is in the full-viewport expanded overlay. */
  expanded: boolean
  /** Toggle the expanded overlay (also the Collapse control inside it). */
  onToggleExpanded: () => void
}

export function KanbanPage(props: KanbanPageProps) {
  const {
    board,
    boards,
    selectedBoard,
    onSelectBoard,
    liveStatus,
    isLoading,
    isFetching,
    error,
    onRetry,
    onOpenCard,
    onCreateCard,
    onMoveCard,
    movePendingId,
    onStopCard,
    stopPendingId,
    stats,
    expanded,
    onToggleExpanded,
  } = props

  // The board is the live, non-archived view: always drop any `archived` column. The
  // backend already orders the 8 standard columns first.
  const columns = useMemo<KanbanColumn[]>(() => {
    if (!board || board.available === false) return []
    return board.data.columns.filter((c) => c.name !== 'archived')
  }, [board])

  const available = board?.available !== false
  const boardLabel =
    boards.find((b) => b.slug === selectedBoard)?.name || (selectedBoard ? selectedBoard : 'Board')

  // The board lane (the columns) — desktop keeps the broad multi-lane board;
  // small screens get a selector-driven single lane so cards are readable
  // without clipped fixed-width columns.
  const lane =
    columns.length === 0 ? (
      <EmptyState
        icon={KanbanSquare}
        title="No tasks yet"
        description="When your agent creates and claims tasks, they’ll flow across these columns here in real time."
      />
    ) : (
      <ResponsiveBoard
        columns={columns}
        onOpenCard={onOpenCard}
        onMoveCard={onMoveCard}
        movePendingId={movePendingId}
        onStopCard={onStopCard}
        stopPendingId={stopPendingId}
      />
    )

  // Header actions shared by the surface header and (a subset) the expanded bar.
  const headerActions = available ? (
    <>
      {onCreateCard ? (
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11 md:min-h-7"
          onClick={onCreateCard}
          data-icon="inline-start"
        >
          <Plus className="size-3.5" aria-hidden />
          New card
        </Button>
      ) : null}
      <BoardSelector
        boards={boards}
        value={selectedBoard}
        onChange={onSelectBoard}
        disabled={isFetching}
      />
      <LiveDot status={liveStatus} />
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onToggleExpanded}
        aria-label="Expand board to fill the window"
        aria-keyshortcuts="Shift+E"
        title="Expand board"
        data-testid="kanban-expand"
        className="size-11 text-muted-foreground hover:text-foreground md:size-7"
      >
        <Maximize2 className="size-4" />
      </Button>
    </>
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SurfaceHeader
        icon={KanbanSquare}
        title="Board"
        subtitle={available ? 'Your task board, live' : undefined}
        actions={headerActions}
      />

      {available ? <BoardStatsBar stats={stats ?? null} /> : null}

      <BoardScroller>
        {error ? (
          <ErrorState
            icon={KanbanSquare}
            title="Couldn’t load the board"
            description="The task board couldn’t load. Your agent may be offline; retry when it’s reachable."
            onRetry={onRetry}
          />
        ) : !available ? (
          <EmptyState
            icon={KanbanSquare}
            title="Task tracking isn’t enabled yet"
            description="Enable task tracking on your agent. The Board will show your tasks here."
          />
        ) : isLoading ? (
          <BoardSkeleton />
        ) : (
          // When expanded the lane renders in the overlay below; the in-flow slot
          // shows a calm placeholder so the surface doesn't look empty behind it.
          !expanded && lane
        )}
        {available && expanded ? <ExpandedPlaceholder /> : null}
      </BoardScroller>

      {/* The full-viewport expanded overlay. Mounted only when expanded so it never
          traps focus or locks scroll otherwise. Carries the New-card + selector +
          live dot actions so you can keep working without collapsing first. */}
      {available && expanded ? (
        <KanbanExpandedShell
          open={expanded}
          onCollapse={onToggleExpanded}
          title={boardLabel}
          actions={
            <>
              {onCreateCard ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11 md:min-h-7"
                  onClick={onCreateCard}
                  data-icon="inline-start"
                >
                  <Plus className="size-3.5" aria-hidden />
                  New card
                </Button>
              ) : null}
              <BoardSelector
                boards={boards}
                value={selectedBoard}
                onChange={onSelectBoard}
                disabled={isFetching}
              />
              <LiveDot status={liveStatus} />
            </>
          }
        >
          {isLoading ? <BoardSkeleton /> : lane}
        </KanbanExpandedShell>
      ) : null}
    </div>
  )
}

/** A calm in-flow note shown behind the expanded overlay (the board lives there now). */
function ExpandedPlaceholder() {
  return (
    <div
      className="grid h-full place-items-center text-center text-[12px] text-foreground-tertiary"
      aria-hidden
    >
      <p>Board expanded. Press Esc or Collapse to return here.</p>
    </div>
  )
}

function ResponsiveBoard({
  columns,
  onOpenCard,
  onMoveCard,
  movePendingId,
  onStopCard,
  stopPendingId,
}: {
  columns: KanbanColumn[]
  onOpenCard: (id: string) => void
  onMoveCard?: (id: string, target: KanbanMoveTarget) => void
  movePendingId?: string | null
  onStopCard?: (id: string, runId: number) => void
  stopPendingId?: string | null
}) {
  const mobile = useIsSmallBoardViewport()

  if (mobile) {
    return (
      <MobileBoard
        columns={columns}
        onOpenCard={onOpenCard}
        onMoveCard={onMoveCard}
        movePendingId={movePendingId}
        onStopCard={onStopCard}
        stopPendingId={stopPendingId}
      />
    )
  }

  return (
    <div className="flex min-h-full items-start gap-4" data-testid="kanban-board">
      {columns.map((column) => (
        <BoardColumn
          key={column.name}
          column={column}
          onOpenCard={onOpenCard}
          onMoveCard={onMoveCard}
          movePendingId={movePendingId}
          onStopCard={onStopCard}
          stopPendingId={stopPendingId}
        />
      ))}
    </div>
  )
}

function MobileBoard({
  columns,
  onOpenCard,
  onMoveCard,
  movePendingId,
  onStopCard,
  stopPendingId,
}: {
  columns: KanbanColumn[]
  onOpenCard: (id: string) => void
  onMoveCard?: (id: string, target: KanbanMoveTarget) => void
  movePendingId?: string | null
  onStopCard?: (id: string, runId: number) => void
  stopPendingId?: string | null
}) {
  const firstUsefulColumn = columns.find((column) => column.cards.length > 0) ?? columns[0]
  const [selected, setSelected] = useState(firstUsefulColumn?.name ?? '')
  const selectedName = columns.some((column) => column.name === selected)
    ? selected
    : firstUsefulColumn?.name
  const selectedColumn = columns.find((column) => column.name === selectedName) ?? columns[0]

  return (
    <div className="grid gap-3" data-testid="kanban-mobile-board">
      <label className="grid gap-1.5">
        <span className="ad-section-label">Lane</span>
        <select
          value={selectedColumn?.name ?? ''}
          onChange={(event) => setSelected(event.target.value as KanbanColumn['name'])}
          className="ad-surface h-11 w-full rounded-lg bg-surface-1 px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ad-focus md:h-10"
        >
          {columns.map((column) => {
            const meta = COLUMN_SELECT_META[column.name]
            return (
              <option key={column.name} value={column.name}>
                {meta} ({column.cards.length})
              </option>
            )
          })}
        </select>
      </label>

      {selectedColumn ? (
        <BoardColumn
          column={selectedColumn}
          onOpenCard={onOpenCard}
          onMoveCard={onMoveCard}
          movePendingId={movePendingId}
          onStopCard={onStopCard}
          stopPendingId={stopPendingId}
          className="w-full shrink"
          testId="kanban-mobile-column"
        />
      ) : null}
    </div>
  )
}

function useIsSmallBoardViewport() {
  const [small, setSmall] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)').matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 767px)')
    const onChange = () => setSmall(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return small
}

const COLUMN_SELECT_META: Record<KanbanColumn['name'], string> = {
  triage: 'Incoming',
  todo: 'To do',
  scheduled: 'Scheduled',
  ready: 'Ready',
  running: 'Running',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
}

/**
 * The board's live-connection dot, built on the shared {@link StatusDot}. The
 * board socket actively PUSHING updates is a genuine LIVE DATA STREAM, so
 * `connected` is the ONE sanctioned `--primary` live-accent pulse (the spine
 * reserves amber for live/active state) — distinct from a mere gateway
 * *connection* being online, which reads success-green via ConnectionDot.
 * connecting → the `info` in-progress heartbeat; disconnected → `idle`.
 */
const KANBAN_LIVE: Record<
  KanbanLiveStatus,
  { label: string; tone: StatusTone; live: boolean; pulse: boolean }
> = {
  connected: { label: 'Live', tone: 'ok', live: true, pulse: true },
  connecting: { label: 'Connecting', tone: 'info', live: false, pulse: true },
  disconnected: { label: 'Offline', tone: 'idle', live: false, pulse: false },
}

function LiveDot({ status }: { status: KanbanLiveStatus }) {
  const { label, tone, live, pulse } = KANBAN_LIVE[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
      data-testid="kanban-live-dot"
      data-status={status}
    >
      <StatusDot tone={tone} label={`Board updates: ${label}`} live={live} pulse={pulse} />
      <span aria-hidden>{label}</span>
    </span>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex items-start gap-4" aria-hidden data-testid="kanban-skeleton">
      {Array.from({ length: 5 }).map((_, col) => (
        <div key={col} className="flex w-[272px] shrink-0 flex-col gap-2">
          <div className="h-4 w-24 animate-pulse rounded bg-surface-2/60" />
          {Array.from({ length: 3 }).map((__, card) => (
            <div key={card} className="h-20 animate-pulse rounded-md bg-surface-2/60" />
          ))}
        </div>
      ))}
    </div>
  )
}
