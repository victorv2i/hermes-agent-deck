/**
 * useKanbanLive — the bridge that makes the board move in real time. It owns one
 * {@link KanbanSocket} for the active board and writes every inbound
 * `kanban.snapshot` STRAIGHT INTO the board's TanStack Query cache entry
 * ({@link kanbanKeys.board}). The board component just reads that query, so a
 * card moving column re-renders with no refetch — the "watch work happen" feel.
 *
 * One exception: while a board-mutating write (move / run) is IN FLIGHT, the
 * snapshot board-cache write is SKIPPED. The mutation has optimistically moved the
 * card; a stale upstream snapshot would clobber that optimistic state (the card
 * snaps back, then re-moves once the move resolves). The mutation's `onSettled`
 * invalidates the board, and the next snapshot after it settles writes through, so
 * the board re-syncs cleanly. The open-task invalidation still runs (it never
 * fights the optimistic move — it only refreshes the drawer's detail query).
 *
 * It also invalidates the open task's detail on each snapshot (cheap, only when a
 * card is open) so the drawer's log/comments track the live board. The socket is
 * injectable so the hook is unit-testable in jsdom without a live gateway.
 */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KanbanSocket, type KanbanSocketLike, type KanbanLiveStatus } from './kanbanSocket'
import { kanbanKeys, KANBAN_BOARD_MUTATION_KEY } from './hooks'

export interface UseKanbanLiveOptions {
  /** Inject a transport for tests; defaults to a real same-origin connection. */
  socket?: KanbanSocketLike
  /** The task id currently open in the drawer (to invalidate its detail), if any. */
  openTaskId?: string | null
}

/** Subscribe the live `/kanban` channel for `board` and feed the cache.
 * Returns the connection status for a header "live" dot. */
export function useKanbanLive(
  board: string | undefined,
  options: UseKanbanLiveOptions = {},
): KanbanLiveStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<KanbanLiveStatus>('connecting')
  // Keep the open-task id in a ref so the snapshot handler always sees the latest
  // without re-creating the socket when the drawer opens/closes. Synced in an
  // effect (never during render) so the ref write doesn't fight React.
  const openTaskRef = useRef<string | null | undefined>(options.openTaskId)
  useEffect(() => {
    openTaskRef.current = options.openTaskId
  }, [options.openTaskId])

  const injected = options.socket
  useEffect(() => {
    const live = new KanbanSocket(
      {
        onSnapshot: (snapshot) => {
          // Hold the board write while an optimistic move/run is in flight — a stale
          // snapshot would clobber it (snap back, then re-move). The mutation's
          // onSettled re-syncs the board, and the next snapshot writes through.
          if (qc.isMutating({ mutationKey: KANBAN_BOARD_MUTATION_KEY }) === 0) {
            // Write the fresh board straight into the cache entry the board reads.
            qc.setQueryData(kanbanKeys.board(board), snapshot)
          }
          // If a card is open, refresh its detail so the drawer tracks the board.
          const openId = openTaskRef.current
          if (openId) {
            void qc.invalidateQueries({ queryKey: kanbanKeys.task(openId, board) })
          }
        },
        onStatusChange: setStatus,
      },
      injected ? { socket: injected } : {},
    )
    live.connect()
    live.subscribe(board)
    return () => live.dispose()
    // Re-subscribe (a fresh socket) when the watched board changes; `qc`/`injected`
    // are stable, so this effectively keys on `board`.
  }, [board, injected, qc])

  return status
}
