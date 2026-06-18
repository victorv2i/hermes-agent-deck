import { z } from 'zod'

/**
 * Kanban DTOs — the WHITELISTED view of hermes's native kanban dashboard plugin
 * (auto-mounted at `/api/plugins/kanban/`, SQLite-backed cross-profile coordination
 * board). The plugin returns a far richer shape per task than a remote Agentdeck
 * operator needs (diagnostics rule output, link graphs, attachment stored paths,
 * worker PIDs, claim locks, on-disk log paths); these schemas are the contract that
 * keeps the wire shape SLIM, stable, and free of filesystem/host internals.
 *
 * Authoritative upstream shapes: hermes-agent plugins/kanban/dashboard/plugin_api.py
 *   GET /board          → { columns: [{name, tasks: [...]}], assignees, latest_event_id, now }
 *   GET /tasks/:id      → { task, comments, events, attachments, links, runs }
 *   GET /workers/active → { workers: [...], count, checked_at }
 *   GET /stats          → { by_status, by_assignee, oldest_ready_age_seconds, now }
 *   GET /boards         → { boards: [...], current }
 *
 * SECURITY: stored attachment paths, worker PIDs, claim locks, idempotency keys, and
 * worker log paths are NOT surfaced. Anything not declared here cannot reach the client.
 *
 * This cut is READ-ONLY — no task-write DTOs.
 */

/**
 * The eight board columns in their fixed left-to-right order. `archived` is a filter
 * toggle on the upstream `/board?include_archived=true`, surfaced as a 9th column only
 * when the caller opts in — it is NOT part of the default ordered set.
 */
export const KANBAN_COLUMNS = [
  'triage',
  'todo',
  'scheduled',
  'ready',
  'running',
  'blocked',
  'review',
  'done',
] as const

/** A task's status / column — the governed vocabulary (plus `archived`). */
export const KanbanColumnName = z.enum([...KANBAN_COLUMNS, 'archived'])
export type KanbanColumnName = z.infer<typeof KanbanColumnName>

/** A worker's run info, attached to a card in the `running` column (and to the drawer). */
export const KanbanRun = z.object({
  /** The `task_runs` row id. */
  id: z.number(),
  /** Profile (worker identity) executing the run. */
  profile: z.string().nullable(),
  /** Run lifecycle status (e.g. "running", "reclaimed", "ended"). */
  status: z.string().nullable(),
  /** Terminal outcome once ended (e.g. "completed", "timed_out", "crashed"). */
  outcome: z.string().nullable(),
  /** Worker's handoff summary (full on the drawer; null until produced). */
  summary: z.string().nullable(),
  /** Epoch seconds the run started (null if not started). */
  startedAt: z.number().nullable(),
  /** Epoch seconds the run ended (null while in-flight). */
  endedAt: z.number().nullable(),
})
export type KanbanRun = z.infer<typeof KanbanRun>

/** Derived age metrics the plugin computes so the UI colours stale cards without deltas. */
export const KanbanCardAge = z.object({
  createdAgeSeconds: z.number().nullable(),
  startedAgeSeconds: z.number().nullable(),
  timeToCompleteSeconds: z.number().nullable(),
})
export type KanbanCardAge = z.infer<typeof KanbanCardAge>

/**
 * A compact warnings/diagnostics badge for a card. This is a COUNT-only rollup —
 * the upstream per-rule diagnostic detail lives behind the separate board-level
 * `/api/plugins/kanban/diagnostics` route, which is NOT card-keyed and is NOT
 * surfaced here, so there is no per-card warning detail to show on the drawer. The
 * card badge therefore stands alone as an honest status indicator (count + severity).
 */
export const KanbanWarningsSummary = z.object({
  /** Total diagnostic count rolled up across kinds. */
  count: z.number(),
  /** Highest severity present ("warning" | "error" | "critical"), or null. */
  highestSeverity: z.string().nullable(),
})
export type KanbanWarningsSummary = z.infer<typeof KanbanWarningsSummary>

/**
 * A single card on the board. `worker` is populated for cards in the `running` column
 * (the active run); null otherwise. Filesystem/host internals (worker_pid, claim_lock,
 * workspace_path, idempotency_key) are intentionally omitted.
 */
export const KanbanCard = z.object({
  /** Stable task id (hermes uses a `t_<hex>` form). */
  id: z.string(),
  title: z.string(),
  /** The column this card lives in (== its status). */
  column: KanbanColumnName,
  /** Worker profile the task is assigned to (null when unassigned). */
  assignee: z.string().nullable(),
  /** Task priority (higher sorts first within a column). */
  priority: z.number(),
  /** Latest worker handoff summary, truncated to a card preview (null when none). */
  latestSummary: z.string().nullable(),
  /** Epoch seconds the task was created. */
  createdAt: z.number().nullable(),
  /** Epoch seconds the task started running (null until claimed). */
  startedAt: z.number().nullable(),
  /** Epoch seconds the task completed (null until done). */
  completedAt: z.number().nullable(),
  /** Derived age metrics (null fields when not computable). */
  age: KanbanCardAge.nullable(),
  /** Active run info — present for `running` cards, null otherwise. */
  worker: KanbanRun.nullable(),
  /** Number of comments on the task (for the card badge). */
  commentCount: z.number(),
  /** Parent/child link counts (for the card badge). */
  linkCounts: z.object({ parents: z.number(), children: z.number() }),
  /** Child-progress rollup `{done, total}` when the task has children, else null. */
  progress: z.object({ done: z.number(), total: z.number() }).nullable(),
  /** Compact diagnostics badge, or null when the task has no active diagnostics. */
  warnings: KanbanWarningsSummary.nullable(),
})
export type KanbanCard = z.infer<typeof KanbanCard>

/** One ordered column with its cards. */
export const KanbanColumn = z.object({
  name: KanbanColumnName,
  cards: z.array(KanbanCard),
})
export type KanbanColumn = z.infer<typeof KanbanColumn>

/**
 * The full board. `columns` are ALWAYS in {@link KANBAN_COLUMNS} order (archived last
 * when included). `cursor` is the upstream `latest_event_id` — the live channel uses it
 * to detect change. `now` is the server epoch the snapshot was taken (for age display).
 */
export const KanbanBoard = z.object({
  /** Slug of the board this snapshot is for (the active board when unspecified). */
  board: z.string(),
  columns: z.array(KanbanColumn),
  /** Distinct assignees on the board (for the lane/filter UI). */
  assignees: z.array(z.string()),
  /** Monotonic event cursor (upstream `latest_event_id`); drives liveness. */
  cursor: z.number(),
  /** Server epoch seconds the snapshot was taken. */
  now: z.number(),
})
export type KanbanBoard = z.infer<typeof KanbanBoard>

/** A comment on a task (drawer). */
export const KanbanComment = z.object({
  id: z.number(),
  author: z.string().nullable(),
  body: z.string(),
  createdAt: z.number().nullable(),
})
export type KanbanComment = z.infer<typeof KanbanComment>

/** An event in a task's append-only history (drawer). */
export const KanbanEvent = z.object({
  id: z.number(),
  kind: z.string(),
  createdAt: z.number().nullable(),
})
export type KanbanEvent = z.infer<typeof KanbanEvent>

/**
 * Full task detail for the drawer. Carries the card plus its full (untruncated)
 * summary, comments, events, run history, and parent/child link ids. Attachment
 * stored paths and worker PIDs are NOT included.
 */
export const KanbanTask = z.object({
  card: KanbanCard,
  /** Full task body / description (null when empty). */
  body: z.string().nullable(),
  /** Full worker handoff summary, untruncated (null when none). */
  latestSummary: z.string().nullable(),
  comments: z.array(KanbanComment),
  events: z.array(KanbanEvent),
  runs: z.array(KanbanRun),
  /** Parent/child task ids. */
  links: z.object({ parents: z.array(z.string()), children: z.array(z.string()) }),
})
export type KanbanTask = z.infer<typeof KanbanTask>

/** An active worker (a running task's in-flight run), for the workers strip. */
export const KanbanWorker = z.object({
  runId: z.number(),
  taskId: z.string(),
  taskTitle: z.string().nullable(),
  assignee: z.string().nullable(),
  profile: z.string().nullable(),
  /** Epoch seconds the run started. */
  startedAt: z.number().nullable(),
  /** Epoch seconds of the worker's last heartbeat (null if none yet). */
  lastHeartbeatAt: z.number().nullable(),
})
export type KanbanWorker = z.infer<typeof KanbanWorker>

/** The active-workers payload. */
export const KanbanWorkers = z.object({
  workers: z.array(KanbanWorker),
  count: z.number(),
  /** Server epoch seconds the snapshot was taken. */
  checkedAt: z.number(),
})
export type KanbanWorkers = z.infer<typeof KanbanWorkers>

/** Per-status + per-assignee counts + oldest-ready age (the HUD). */
export const KanbanStats = z.object({
  byStatus: z.record(z.string(), z.number()),
  byAssignee: z.record(z.string(), z.record(z.string(), z.number())),
  /** Age in seconds of the oldest `ready` task (null when none ready). */
  oldestReadyAgeSeconds: z.number().nullable(),
  now: z.number(),
})
export type KanbanStats = z.infer<typeof KanbanStats>

/** A board in the multi-project list. */
export const KanbanBoardSummary = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  /** Whether this is the active board. */
  isCurrent: z.boolean(),
  /** Total non-archived task count. */
  total: z.number(),
  /** Per-status counts for the board. */
  counts: z.record(z.string(), z.number()),
})
export type KanbanBoardSummary = z.infer<typeof KanbanBoardSummary>

/** The board list payload. */
export const KanbanBoardList = z.object({
  boards: z.array(KanbanBoardSummary),
  /** Slug of the active board. */
  current: z.string(),
})
export type KanbanBoardList = z.infer<typeof KanbanBoardList>

/**
 * The PORTABILITY contract. Every kanban BFF response is one of these two shapes:
 *   - `{ available: false }`            → the kanban plugin is not installed/enabled
 *                                         on this hermes (the UI shows an honest
 *                                         "Kanban isn't enabled" empty state).
 *   - `{ available: true, data: <T> }`  → the plugin is present; `data` is the DTO.
 *
 * The BFF NEVER 500s on a missing plugin — it returns `available: false` so the UI
 * degrades gracefully regardless of which hermes it is pointed at.
 */
export type KanbanAvailability<T> = { available: false } | { available: true; data: T }

/** Build the availability schema for a given inner DTO. */
export function kanbanAvailability<T extends z.ZodTypeAny>(
  inner: T,
): z.ZodType<{ available: false } | { available: true; data: z.infer<T> }> {
  return z.union([
    z.object({ available: z.literal(false) }),
    z.object({ available: z.literal(true), data: inner }),
  ]) as z.ZodType<{ available: false } | { available: true; data: z.infer<T> }>
}

/** The board-availability response (`GET /api/agent-deck/kanban/board`). */
export const KanbanBoardResponse = kanbanAvailability(KanbanBoard)
export type KanbanBoardResponse = KanbanAvailability<KanbanBoard>

/** The board-list response (`GET /api/agent-deck/kanban/boards`). */
export const KanbanBoardListResponse = kanbanAvailability(KanbanBoardList)
export type KanbanBoardListResponse = KanbanAvailability<KanbanBoardList>

/** The task-detail response (`GET /api/agent-deck/kanban/tasks/:id`). */
export const KanbanTaskResponse = kanbanAvailability(KanbanTask)
export type KanbanTaskResponse = KanbanAvailability<KanbanTask>

/** The active-workers response (`GET /api/agent-deck/kanban/workers/active`). */
export const KanbanWorkersResponse = kanbanAvailability(KanbanWorkers)
export type KanbanWorkersResponse = KanbanAvailability<KanbanWorkers>

/** The stats response (`GET /api/agent-deck/kanban/stats`). */
export const KanbanStatsResponse = kanbanAvailability(KanbanStats)
export type KanbanStatsResponse = KanbanAvailability<KanbanStats>

/**
 * The `/kanban` Socket.IO namespace path + wire event names for live board updates.
 *
 *   client → server:
 *     'kanban.subscribe'  { board? }      start receiving snapshots for a board
 *   server → client:
 *     'kanban.snapshot'   KanbanBoardResponse   a fresh board (sent on subscribe and
 *                                               whenever the upstream cursor advances)
 *     'kanban.error'      { message }            a transient upstream error (UI stays calm)
 *
 * The server polls the upstream board on a short interval and emits a `kanban.snapshot`
 * only when the cursor changes (or on first subscribe), so an idle board is quiet.
 */
export const KANBAN_NAMESPACE = '/kanban'

export const KanbanSubscribeCommand = z.object({
  /** Board slug to watch (omit for the active board). */
  board: z.string().optional(),
})
export type KanbanSubscribeCommand = z.infer<typeof KanbanSubscribeCommand>

/* -------------------------------------------------------------------------- */
/* Mutations — the WRITABLE cut.                                              */
/*                                                                            */
/* These three writes map 1:1 onto REAL stock kanban-plugin routes (verified  */
/* against hermes-agent plugins/kanban/dashboard/plugin_api.py — see          */
/* knownHermesRoutes.ts cites):                                               */
/*   create  → POST /api/plugins/kanban/tasks                 (plugin_api.py:586)  */
/*   move    → POST /api/plugins/kanban/tasks/bulk            (plugin_api.py:1148) */
/*   comment → POST /api/plugins/kanban/tasks/{id}/comments   (plugin_api.py:1078) */
/* Anything not backed by a real route is intentionally absent — no fake write. */
/* -------------------------------------------------------------------------- */

/**
 * The columns a card can be MOVED INTO via the bulk-status route — the HONEST
 * subset of {@link KANBAN_COLUMNS}. Verified against the upstream `bulk_update`
 * switch (plugin_api.py): it accepts `done | blocked | ready | scheduled | todo
 * | triage`, but REJECTS `running` ("use the dispatcher/claim path") and `review`
 * ("unknown status"); `archived` is reached via a separate archive flag, not a
 * status move. The board only offers these as drop targets so a move never lands
 * on a transition the backend would refuse.
 */
export const KANBAN_MOVE_TARGETS = [
  'triage',
  'todo',
  'scheduled',
  'ready',
  'blocked',
  'done',
] as const

/** A column a card can be moved into (the writable subset). */
export const KanbanMoveTarget = z.enum(KANBAN_MOVE_TARGETS)
export type KanbanMoveTarget = z.infer<typeof KanbanMoveTarget>

/** True when `column` is a real, backend-accepted move target. */
export function isMoveTarget(column: KanbanColumnName): column is KanbanMoveTarget {
  return (KANBAN_MOVE_TARGETS as readonly string[]).includes(column)
}

/**
 * Create-task request (the composer). Mirrors the upstream `CreateTaskBody`'s
 * dashboard-relevant fields; the rest (workspace_kind, idempotency_key, …) keep
 * their upstream defaults. `title` is the only required field.
 */
export const KanbanCreateTaskInput = z.object({
  title: z.string().trim().min(1, 'A title is required').max(500),
  body: z.string().max(20_000).optional(),
  assignee: z.string().max(200).optional(),
  /** Higher sorts first within a column (upstream default 0). */
  priority: z.number().int().optional(),
})
export type KanbanCreateTaskInput = z.infer<typeof KanbanCreateTaskInput>

/** Create-task response: the new card's id (echoed for cache placement). */
export const KanbanCreateTaskResult = z.object({ id: z.string() })
export type KanbanCreateTaskResult = z.infer<typeof KanbanCreateTaskResult>

/** Move-card request: the target column for a single card. */
export const KanbanMoveTaskInput = z.object({ status: KanbanMoveTarget })
export type KanbanMoveTaskInput = z.infer<typeof KanbanMoveTaskInput>

/**
 * Move-card result: `ok` + (when refused) the per-id `error` the upstream bulk
 * route returned, so the UI can roll back AND show the real reason rather than a
 * generic failure (e.g. "transition to 'ready' refused" when parents aren't done).
 */
export const KanbanMoveTaskResult = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
})
export type KanbanMoveTaskResult = z.infer<typeof KanbanMoveTaskResult>

/** Add-comment request. */
export const KanbanCommentInput = z.object({
  body: z.string().trim().min(1, 'A comment can’t be empty').max(20_000),
})
export type KanbanCommentInput = z.infer<typeof KanbanCommentInput>

/** Add-comment result. */
export const KanbanCommentResult = z.object({ ok: z.boolean() })
export type KanbanCommentResult = z.infer<typeof KanbanCommentResult>

/* -------------------------------------------------------------------------- */
/* Orchestration — the run-control cut. The board doesn't just SHOW work; it  */
/* DRIVES it. Each of these maps 1:1 onto a REAL stock kanban-plugin route     */
/* (verified against hermes-agent plugins/kanban/dashboard/plugin_api.py — see */
/* knownHermesRoutes.ts cites):                                                */
/*   dispatch  → POST /api/plugins/kanban/dispatch                (plugin_api.py:1944) */
/*   terminate → POST /api/plugins/kanban/runs/{run_id}/terminate (plugin_api.py:1494) */
/*   reassign  → POST /api/plugins/kanban/tasks/{id}/reassign     (plugin_api.py:1641) */
/*                                                                            */
/* HONESTY — the load-bearing constraint of this surface: hermes has NO route */
/* that sets a task to `running` directly (the bulk route refuses it: "use    */
/* the dispatcher/claim path"). So "Run this task" is a TWO-STEP truth: move   */
/* the card to `ready`, then NUDGE the dispatcher (`/dispatch`). The dispatcher */
/* spawns a worker on its next tick when a profile has capacity — it is not an */
/* instant guarantee. The UI says exactly this; it never fakes an instant run. */
/* -------------------------------------------------------------------------- */

/**
 * Dispatch-nudge result. The upstream `/dispatch` runs one dispatcher pass and
 * returns a rich `DispatchResult` dataclass; this is the SLIM, host-free view —
 * only the operator-actionable tallies survive. The plugin's `spawned` field is a
 * list of `(task_id, assignee, workspace_path)` triples; we surface the COUNT and
 * the bare task ids only (the workspace path is a host internal and never crosses).
 */
export const KanbanDispatchResult = z.object({
  /** How many ready tasks the dispatcher spawned a worker for this pass. */
  spawned: z.number(),
  /** Task ids that got a worker this pass (for an honest "started N" toast). */
  spawnedIds: z.array(z.string()),
  /** Tasks promoted toward ready this pass (scheduled/blocked auto-unblocked). */
  promoted: z.number(),
  /** Stuck/crashed claims the pass reclaimed (so the work can be retried). */
  reclaimed: z.number(),
  /** Ready task ids skipped for having NO assignee — operator must route them. */
  skippedUnassigned: z.array(z.string()),
})
export type KanbanDispatchResult = z.infer<typeof KanbanDispatchResult>

/**
 * Terminate request. The upstream route keys on the RUN id (not the task id) and
 * accepts an optional reason that lands in the task's event log. A run id is what
 * the running card / drawer already carries on its `worker`/`runs[*]`.
 */
export const KanbanTerminateInput = z.object({
  runId: z.number().int(),
  reason: z.string().max(500).optional(),
})
export type KanbanTerminateInput = z.infer<typeof KanbanTerminateInput>

/**
 * Terminate result. Upstream answers `{ ok: true, run_id, task_id }` on success,
 * 404 when the run is unknown, or 409 when the run already ended / the task is no
 * longer reclaimable. The BFF maps a 409 to an HONEST `{ ok: false, error }` (the
 * worker likely finished on its own) rather than a hard failure, so the UI can say
 * so calmly; the task id is echoed so the caller can refresh the right card.
 */
export const KanbanTerminateResult = z.object({
  ok: z.boolean(),
  taskId: z.string().nullable(),
  error: z.string().nullable(),
})
export type KanbanTerminateResult = z.infer<typeof KanbanTerminateResult>

/**
 * Reassign request. Moves a task to a different worker `profile` (empty / omitted
 * unassigns it). `reclaimFirst` releases an active claim before reassigning — the
 * upstream REFUSES a reassign of a still-running task unless this is set, so the UI
 * passes it when the card is running.
 */
export const KanbanReassignInput = z.object({
  /** The new worker profile; '' or omitted unassigns. */
  profile: z.string().max(200).optional(),
  /** Release a live claim before reassigning (required when the task is running). */
  reclaimFirst: z.boolean().optional(),
  /** Optional reason recorded in the task's event log. */
  reason: z.string().max(500).optional(),
})
export type KanbanReassignInput = z.infer<typeof KanbanReassignInput>

/**
 * Reassign result. Upstream answers `{ ok: true, task_id, assignee }` on success or
 * 409 when the id is unknown / the task is still running without `reclaim_first`.
 * The BFF maps that 409 to an HONEST `{ ok: false, error }` so the UI can show the
 * real reason (and re-offer with reclaim) rather than a generic failure.
 */
export const KanbanReassignResult = z.object({
  ok: z.boolean(),
  assignee: z.string().nullable(),
  error: z.string().nullable(),
})
export type KanbanReassignResult = z.infer<typeof KanbanReassignResult>
