/**
 * KanbanRoute — the Board surface route element (mounted at `/kanban`). Owns the
 * react-query reads (board snapshot · board list · open task detail), the live
 * `/kanban` socket subscription (which streams snapshots into the board cache so
 * cards move in real time), the WRITES (create card · move card · comment), and
 * the local UI state (selected board · open card · composer · expanded). Hands
 * everything to the presentational {@link KanbanPage} + the {@link TaskDrawer}.
 *
 * The selected board + open card live in the URL (`?board=<slug>&card=<id>`), not
 * component state, so a refresh keeps you on the same board with the same task
 * open — and that view is deep-linkable/shareable. An absent `?board=` means "the
 * active board" (the BFF resolves it); an absent `?card=` means no drawer is open.
 *
 * WRITES are honest: each maps onto a real stock kanban-plugin route. A move is
 * optimistic — the card jumps columns instantly — but a backend REFUSAL (e.g.
 * promoting to `ready` with unfinished parents) rolls the move back and toasts
 * the real reason. No fake success anywhere.
 *
 * The live socket is the spine — it makes the board feel connected to your agent;
 * the gentle query poll is only a fallback. There is no archived view: the
 * upstream `/board` omits archived cards and the BFF never requests them.
 */
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { KanbanCard, KanbanMoveTarget } from '@agent-deck/protocol'
import { toast } from '@/lib/toast'
import { CreateCardDialog } from './CreateCardDialog'
import { KanbanPage } from './KanbanPage'
import { TaskDrawer } from './TaskDrawer'
import {
  useKanbanBoard,
  useKanbanBoards,
  useKanbanStats,
  useKanbanTask,
  useMoveTask,
  useTerminateRun,
} from './hooks'
import { useBoardExpand } from './useBoardExpand'
import { useKanbanLive } from './useKanbanLive'

export function KanbanRoute() {
  // The selected board + open card live in the URL so a refresh is stable and the
  // view is deep-linkable. `?board=` ('' / absent → the active board, which the
  // BFF resolves); `?card=` (absent → no drawer open).
  const [params, setParams] = useSearchParams()
  const selectedBoard = params.get('board') ?? ''
  const openCardId = params.get('card')
  const [composerOpen, setComposerOpen] = useState(false)

  const boardSlug = selectedBoard || undefined

  // Switch board = rewrite `?board=` and DROP `?card=` (the open card belongs to
  // the board you're leaving). An empty slug clears `?board=` (back to active).
  const selectBoard = useCallback(
    (slug: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (slug) next.set('board', slug)
          else next.delete('board')
          next.delete('card')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // Open a card = set `?card=`; a null id (drawer close) clears it. Replace so the
  // drawer toggle doesn't pollute Back.
  const openCard = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id) next.set('card', id)
          else next.delete('card')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const boardQuery = useKanbanBoard(boardSlug)
  const boardsQuery = useKanbanBoards()
  const statsQuery = useKanbanStats(boardSlug)
  const taskQuery = useKanbanTask(openCardId, boardSlug)

  // Subscribe the live channel; it writes snapshots straight into the board cache
  // and invalidates the open task on each tick (so the drawer's log stays live).
  const liveStatus = useKanbanLive(boardSlug, { openTaskId: openCardId })

  const expand = useBoardExpand()
  const move = useMoveTask(boardSlug)
  const stop = useTerminateRun(boardSlug)

  const boards = boardsQuery.data?.available ? boardsQuery.data.data.boards : []
  // The effective selected slug for the selector: the user's choice, else the
  // active board reported by the board list (so the dropdown shows the real one).
  const activeSlug =
    selectedBoard || (boardsQuery.data?.available ? boardsQuery.data.data.current : '')

  const boardAvailable = boardQuery.data?.available !== false
  // The board's known assignees -- quick reassign targets for the drawer controls.
  const assignees = boardQuery.data?.available ? boardQuery.data.data.assignees : []

  // The clicked card's slim data backs the drawer header while its detail loads,
  // so the drawer never flashes empty. Found in the current snapshot.
  const openCardData = useMemo<KanbanCard | null>(() => {
    if (!openCardId || !boardQuery.data?.available) return null
    for (const column of boardQuery.data.data.columns) {
      const found = column.cards.find((c) => c.id === openCardId)
      if (found) return found
    }
    return null
  }, [openCardId, boardQuery.data])

  function handleMoveCard(id: string, target: KanbanMoveTarget) {
    move.mutate(
      { id, status: target },
      {
        // A real backend refusal (or a network failure) — the hook already rolled
        // the optimistic move back; surface the honest reason here.
        onError: (err) => {
          toast.error("Couldn't move the card", {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      },
    )
  }

  // Stop a running card's worker straight from the board (terminate its run). The
  // run id rides the enriched running card; a benign "already ended" is honest, not
  // an error.
  function handleStopCard(id: string, runId: number) {
    stop.mutate(
      { id, input: { runId } },
      {
        onSuccess: (result) => {
          if (result.ok) toast.success('Stopped the task')
          else toast.info('The run already ended', { description: result.error ?? undefined })
        },
        onError: (err) => {
          toast.error("Couldn't stop the task", {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      },
    )
  }

  return (
    <>
      <KanbanPage
        board={boardQuery.data}
        boards={boards}
        selectedBoard={activeSlug}
        onSelectBoard={selectBoard}
        liveStatus={liveStatus}
        stats={statsQuery.data?.available ? statsQuery.data.data : null}
        isLoading={boardQuery.isLoading}
        isFetching={boardQuery.isFetching}
        error={boardQuery.error}
        onRetry={() => void boardQuery.refetch()}
        onOpenCard={openCard}
        onCreateCard={() => setComposerOpen(true)}
        onMoveCard={handleMoveCard}
        movePendingId={move.isPending ? (move.variables?.id ?? null) : null}
        onStopCard={handleStopCard}
        stopPendingId={stop.isPending ? (stop.variables?.id ?? null) : null}
        expanded={expand.expanded}
        onToggleExpanded={expand.toggle}
      />
      <TaskDrawer
        card={openCardData}
        task={taskQuery.data?.available ? taskQuery.data.data : undefined}
        isLoading={taskQuery.isLoading}
        open={openCardId !== null}
        onClose={() => openCard(null)}
        board={boardSlug}
        assignees={assignees}
      />
      {boardAvailable ? (
        <CreateCardDialog open={composerOpen} onOpenChange={setComposerOpen} board={boardSlug} />
      ) : null}
    </>
  )
}
