/**
 * Kanban surface client — talks to the kanban BFF (`/api/agent-deck/kanban/*`),
 * which proxies hermes's native kanban dashboard plugin and keeps the wire shape
 * slim (see `@agent-deck/protocol` kanban DTOs). This is the full read + write +
 * orchestration cut: it READS the board / board list / task detail, WRITES tasks
 * (create · move · comment), and DRIVES the agent's work (dispatch · terminate ·
 * reassign). Every write/orchestration call maps onto a REAL stock plugin route —
 * no fabricated endpoints — and returns an `{ ok, error }` so an HONEST refusal
 * (e.g. an impossible move) surfaces rather than faking success.
 *
 * Every route returns the PORTABILITY envelope `{ available: false }` (plugin not
 * installed on this hermes → the UI shows a calm empty state) or `{ available:
 * true, data: <DTO> }`. The shared {@link apiFetch} handles auth + the ok-check +
 * a typed error; this module names routes, builds the optional `?board=` query,
 * and zod-parses each response so a malformed frame fails loudly here rather than
 * smearing `undefined` through the UI.
 */
import {
  KanbanBoardResponse,
  KanbanBoardListResponse,
  KanbanCommentResult,
  KanbanCreateTaskResult,
  KanbanDispatchResult,
  KanbanMoveTaskResult,
  KanbanReassignResult,
  KanbanStatsResponse,
  KanbanTaskResponse,
  KanbanTerminateResult,
  type KanbanCommentInput,
  type KanbanCreateTaskInput,
  type KanbanMoveTarget,
  type KanbanReassignInput,
  type KanbanTerminateInput,
} from '@agent-deck/protocol'
import { apiFetch, apiPost } from '@/lib/apiFetch'

/** Append `?board=<slug>` when a board is named (omit → the active board). */
function boardQuery(board?: string): string {
  return board ? `?board=${encodeURIComponent(board)}` : ''
}

/** GET the board snapshot (8 ordered columns + cards). */
export async function fetchBoard(
  board?: string,
  signal?: AbortSignal,
): Promise<KanbanBoardResponse> {
  const raw = await apiFetch<unknown>(`/kanban/board${boardQuery(board)}`, { signal })
  return KanbanBoardResponse.parse(raw)
}

/** GET the multi-board list (for the board selector). */
export async function fetchBoards(signal?: AbortSignal): Promise<KanbanBoardListResponse> {
  const raw = await apiFetch<unknown>('/kanban/boards', { signal })
  return KanbanBoardListResponse.parse(raw)
}

/** GET the board's queue-health stats (status counts + oldest-ready age) for the HUD. */
export async function fetchStats(
  board?: string,
  signal?: AbortSignal,
): Promise<KanbanStatsResponse> {
  const raw = await apiFetch<unknown>(`/kanban/stats${boardQuery(board)}`, { signal })
  return KanbanStatsResponse.parse(raw)
}

/** GET one task's full detail (the drawer). */
export async function fetchTask(
  id: string,
  board?: string,
  signal?: AbortSignal,
): Promise<KanbanTaskResponse> {
  const raw = await apiFetch<unknown>(
    `/kanban/tasks/${encodeURIComponent(id)}${boardQuery(board)}`,
    { signal },
  )
  return KanbanTaskResponse.parse(raw)
}

/* -------------------------------------------------------------------------- */
/* Mutations — each posts to a BFF route backed by a REAL stock plugin write. */
/* -------------------------------------------------------------------------- */

/** POST a new card (the composer). Returns the new card's id. */
export async function createTask(
  input: KanbanCreateTaskInput,
  board?: string,
): Promise<KanbanCreateTaskResult> {
  const raw = await apiPost<unknown>(`/kanban/tasks${boardQuery(board)}`, input)
  return KanbanCreateTaskResult.parse(raw)
}

/**
 * POST a single-card column move. The `status` is a {@link KanbanMoveTarget} (the
 * backend-accepted subset), so an impossible move never leaves the client. The
 * result carries `{ ok, error }` — an `ok:false` is an HONEST refusal the caller
 * rolls back on (never a fake success).
 */
export async function moveTask(
  id: string,
  status: KanbanMoveTarget,
  board?: string,
): Promise<KanbanMoveTaskResult> {
  const raw = await apiPost<unknown>(
    `/kanban/tasks/${encodeURIComponent(id)}/move${boardQuery(board)}`,
    { status },
  )
  return KanbanMoveTaskResult.parse(raw)
}

/** POST a comment onto a card. */
export async function addComment(
  id: string,
  input: KanbanCommentInput,
  board?: string,
): Promise<KanbanCommentResult> {
  const raw = await apiPost<unknown>(
    `/kanban/tasks/${encodeURIComponent(id)}/comments${boardQuery(board)}`,
    input,
  )
  return KanbanCommentResult.parse(raw)
}

/* -------------------------------------------------------------------------- */
/* Orchestration — the run-control cut. Each posts to a BFF route backed by a  */
/* REAL stock plugin route (dispatch / terminate / reassign). These DRIVE the  */
/* agent's work rather than just reading it.                                   */
/* -------------------------------------------------------------------------- */

/**
 * POST a dispatcher nudge: spawn workers for `ready` tasks now. Returns the slim
 * tally (how many actually started) so the caller can report it honestly — a
 * `spawned:0` is a real, valid outcome (every profile at capacity), not a failure.
 */
export async function dispatch(board?: string): Promise<KanbanDispatchResult> {
  const raw = await apiPost<unknown>(`/kanban/dispatch${boardQuery(board)}`, {})
  return KanbanDispatchResult.parse(raw)
}

/**
 * POST a terminate for a running task's worker (keyed on `runId`). The result's
 * `ok:false` is an HONEST non-fatal outcome (the run already ended), not a throw.
 */
export async function terminateRun(
  id: string,
  input: KanbanTerminateInput,
  board?: string,
): Promise<KanbanTerminateResult> {
  const raw = await apiPost<unknown>(
    `/kanban/tasks/${encodeURIComponent(id)}/terminate${boardQuery(board)}`,
    input,
  )
  return KanbanTerminateResult.parse(raw)
}

/**
 * POST a reassign: move a task to a different worker profile (with optional
 * reclaim-first when it is running). `ok:false` carries the honest refusal reason.
 */
export async function reassignTask(
  id: string,
  input: KanbanReassignInput,
  board?: string,
): Promise<KanbanReassignResult> {
  const raw = await apiPost<unknown>(
    `/kanban/tasks/${encodeURIComponent(id)}/reassign${boardQuery(board)}`,
    input,
  )
  return KanbanReassignResult.parse(raw)
}
