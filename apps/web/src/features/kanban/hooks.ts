/**
 * TanStack Query hooks for the read-only Kanban surface. Reads ride the single
 * app-wide QueryClient (main.tsx) + its converged retry policy. The board query
 * is the live spine: {@link useKanbanLive} pushes socket snapshots straight into
 * its cache entry, so the board re-renders the instant the upstream cursor
 * advances — without a refetch. The query keeps a gentle poll as a fallback for
 * when the live socket is down.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type {
  KanbanBoardResponse,
  KanbanBoardListResponse,
  KanbanCommentInput,
  KanbanCreateTaskInput,
  KanbanMoveTarget,
  KanbanReassignInput,
  KanbanTaskResponse,
  KanbanTerminateInput,
} from '@agent-deck/protocol'
import {
  addComment,
  createTask,
  dispatch,
  fetchBoard,
  fetchBoards,
  fetchTask,
  moveTask,
  reassignTask,
  terminateRun,
} from './kanbanApi'
import { applyOptimisticMove } from './optimisticMove'

/** Query keys. The board key includes the slug (or '' for the active board) so
 * each board caches independently and a board switch is instant on return. */
export const kanbanKeys = {
  all: ['kanban'] as const,
  board: (board?: string) => ['kanban', 'board', board ?? ''] as const,
  boards: ['kanban', 'boards'] as const,
  task: (id: string, board?: string) => ['kanban', 'task', board ?? '', id] as const,
}

/**
 * Shared mutation key for the board-MUTATING writes (move · run). `useKanbanLive`
 * watches `qc.isMutating({ mutationKey })` and SKIPS its snapshot board-cache
 * write while one of these is in flight, so an inbound socket snapshot can't
 * clobber an in-flight optimistic move (the card would otherwise snap back, then
 * re-move when the move resolves). Scoped to the move/run mutations only — comment
 * / dispatch / terminate / reassign don't optimistically rewrite the board cache.
 */
export const KANBAN_BOARD_MUTATION_KEY = ['kanban', 'board-mutation'] as const

/** The fallback poll cadence. The live socket carries updates the instant the
 * upstream cursor moves; this gentle poll only covers a dropped socket. */
export const KANBAN_FALLBACK_REFRESH_MS = 15_000

export function useKanbanBoard(board?: string): UseQueryResult<KanbanBoardResponse> {
  return useQuery({
    queryKey: kanbanKeys.board(board),
    queryFn: ({ signal }) => fetchBoard(board, signal),
    // A short staleness so a board switch refetches but the live socket's pushes
    // (written straight into this cache entry) aren't immediately re-fetched over.
    staleTime: 5_000,
    refetchInterval: KANBAN_FALLBACK_REFRESH_MS,
  })
}

export function useKanbanBoards(): UseQueryResult<KanbanBoardListResponse> {
  return useQuery({
    queryKey: kanbanKeys.boards,
    queryFn: ({ signal }) => fetchBoards(signal),
    staleTime: 30_000,
  })
}

/** The drawer's task detail. Disabled until a card is opened (`id` is null). */
export function useKanbanTask(
  id: string | null,
  board?: string,
): UseQueryResult<KanbanTaskResponse> {
  return useQuery({
    queryKey: kanbanKeys.task(id ?? '', board),
    queryFn: ({ signal }) => fetchTask(id as string, board, signal),
    enabled: id !== null,
    staleTime: 5_000,
  })
}

/* -------------------------------------------------------------------------- */
/* Mutations — optimistic where it reads well, HONEST on failure (rollback +  */
/* a real error surfaced to the caller). Each is backed by a real stock write. */
/* -------------------------------------------------------------------------- */

/** Create a card. On success the board query is invalidated to pull the new card. */
export function useCreateTask(board?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: KanbanCreateTaskInput) => createTask(input, board),
    onSuccess: () => void qc.invalidateQueries({ queryKey: kanbanKeys.board(board) }),
  })
}

/**
 * Move a card to a new column with an OPTIMISTIC board update. The card jumps
 * columns instantly; if the backend REFUSES the transition (`ok:false`, e.g.
 * parents not done) or the request throws, the prior board snapshot is restored
 * and the refusal reason is thrown so the UI can show an honest toast — never a
 * fake success. A genuine success re-syncs from the live socket / a board refetch.
 */
export function useMoveTask(board?: string) {
  const qc = useQueryClient()
  return useMutation({
    // Tags this as a board-mutating write so useKanbanLive holds its snapshot
    // write while the optimistic move is in flight (no clobber-then-re-move flash).
    mutationKey: KANBAN_BOARD_MUTATION_KEY,
    mutationFn: async (vars: { id: string; status: KanbanMoveTarget }) => {
      const result = await moveTask(vars.id, vars.status, board)
      if (!result.ok) {
        // A real, server-side refusal — surface it as an error so onError rolls back.
        throw new Error(result.error ?? 'The board refused that move.')
      }
      return result
    },
    onMutate: async (vars) => {
      const key = kanbanKeys.board(board)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<KanbanBoardResponse>(key)
      qc.setQueryData<KanbanBoardResponse>(key, (prev) =>
        prev ? applyOptimisticMove(prev, vars.id, vars.status) : prev,
      )
      return { previous, key }
    },
    onError: (_err, _vars, ctx) => {
      // Roll the optimistic move back to exactly the prior snapshot.
      if (ctx) qc.setQueryData(ctx.key, ctx.previous)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: kanbanKeys.board(board) }),
  })
}

/**
 * Add a comment to a card. On success both the open task detail and the board
 * (its comment-count badge) are invalidated so the new comment + count appear.
 */
export function useAddComment(board?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; input: KanbanCommentInput }) =>
      addComment(vars.id, vars.input, board),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: kanbanKeys.task(vars.id, board) })
      void qc.invalidateQueries({ queryKey: kanbanKeys.board(board) })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Orchestration — the run-control mutations. These DRIVE agent work. Each is  */
/* backed by a real stock plugin route (dispatch / terminate / reassign).      */
/*                                                                            */
/* HONESTY: there is NO direct "set running" route, so RUNNING a task is the   */
/* two-step truth move-to-ready THEN nudge the dispatcher ({@link useRunTask}). */
/* The dispatcher spawns when a profile has capacity — not an instant promise. */
/* -------------------------------------------------------------------------- */

/**
 * Nudge the dispatcher to spawn workers for ready tasks now. Returns the slim
 * tally; the caller surfaces it honestly (`spawned:0` is a valid "nothing to
 * start / all profiles busy" outcome). Invalidates the board so newly-running
 * cards appear.
 */
export function useDispatch(board?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => dispatch(board),
    onSuccess: () => void qc.invalidateQueries({ queryKey: kanbanKeys.board(board) }),
  })
}

/**
 * Run a task: the HONEST two-step. First move the card to `ready` (a real move
 * the backend may refuse, e.g. unfinished parents — that throws and rolls nothing
 * back here, the caller toasts it), then nudge the dispatcher so a worker is
 * spawned without waiting for the periodic tick. Resolves to the dispatch tally so
 * the caller can say how many tasks (incl. this one) actually started. The card is
 * NOT optimistically shown as running — that would be a fake state; it shows as
 * ready until the dispatcher's spawn lands on the next board snapshot.
 */
export function useRunTask(board?: string) {
  const qc = useQueryClient()
  return useMutation({
    // A run starts with a real move-to-ready, so it shares the board-mutation key:
    // useKanbanLive holds its snapshot write until the move/dispatch settles.
    mutationKey: KANBAN_BOARD_MUTATION_KEY,
    mutationFn: async (vars: { id: string }) => {
      const moved = await moveTask(vars.id, 'ready', board)
      if (!moved.ok) {
        throw new Error(moved.error ?? 'The board refused to make this task ready.')
      }
      return dispatch(board)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: kanbanKeys.board(board) }),
  })
}

/**
 * Stop a running task by terminating its worker run (keyed on `runId`). A
 * `{ ok:false }` result is HONEST (the run already ended) and is NOT thrown — the
 * caller decides how to phrase it. Invalidates the open task + board so the card
 * leaves the running column.
 */
export function useTerminateRun(board?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; input: KanbanTerminateInput }) =>
      terminateRun(vars.id, vars.input, board),
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: kanbanKeys.task(vars.id, board) })
      void qc.invalidateQueries({ queryKey: kanbanKeys.board(board) })
    },
  })
}

/**
 * Reassign a task to a different worker profile. A `{ ok:false }` (e.g. still
 * running without reclaim) is surfaced as an error so the caller can re-offer with
 * reclaim. Invalidates the open task + board so the new assignee shows.
 */
export function useReassignTask(board?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; input: KanbanReassignInput }) => {
      const result = await reassignTask(vars.id, vars.input, board)
      if (!result.ok) {
        throw new Error(result.error ?? 'The board refused that reassignment.')
      }
      return result
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: kanbanKeys.task(vars.id, board) })
      void qc.invalidateQueries({ queryKey: kanbanKeys.board(board) })
    },
  })
}
