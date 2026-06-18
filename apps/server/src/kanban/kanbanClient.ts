/**
 * Typed wrapper over hermes's native kanban dashboard plugin
 * (`/api/plugins/kanban/*`, auto-mounted when the plugin is installed — see
 * hermes-agent plugins/kanban/dashboard/plugin_api.py). It maps the plugin's rich
 * raw board/task/worker/stats dicts into the SLIM, whitelisted DTOs in
 * packages/protocol/src/kanban.ts, so a remote Agentdeck operator never learns the
 * server's filesystem layout, worker PIDs, claim locks, or idempotency keys.
 *
 * Auth + transport are delegated to the shared {@link DashboardClient}; this layer
 * only names routes, normalizes payloads, fixes column order, and — critically —
 * implements GRACEFUL DEGRADE: when the kanban plugin is not installed on this
 * hermes the upstream route 404s, and every method resolves to `{ available: false }`
 * rather than throwing, so the BFF can answer honestly without a 500.
 *
 * This cut is READ-ONLY: board / boards / task / workers / stats. No task writes.
 */
import { DashboardError } from '../hermes/dashboardClient'
import {
  KANBAN_COLUMNS,
  type KanbanBoard,
  type KanbanBoardList,
  type KanbanBoardResponse,
  type KanbanBoardListResponse,
  type KanbanCard,
  type KanbanColumn,
  type KanbanColumnName,
  type KanbanCommentInput,
  type KanbanCommentResult,
  type KanbanCreateTaskInput,
  type KanbanCreateTaskResult,
  type KanbanDispatchResult,
  type KanbanMoveTaskInput,
  type KanbanMoveTaskResult,
  type KanbanReassignInput,
  type KanbanReassignResult,
  type KanbanRun,
  type KanbanTerminateInput,
  type KanbanTerminateResult,
  type KanbanStats,
  type KanbanStatsResponse,
  type KanbanTask,
  type KanbanTaskResponse,
  type KanbanWorkers,
  type KanbanWorkersResponse,
} from '@agent-deck/protocol'

/** Minimal slice of DashboardClient this client needs (eases test injection). */
export interface KanbanDashboard {
  getJson<T>(path: string): Promise<T>
  postJson<T>(path: string, body: unknown): Promise<T>
  authedFetch(path: string, init?: RequestInit): Promise<Response>
}

/** Base path the kanban plugin mounts at on the loopback dashboard. */
const KANBAN_BASE = '/api/plugins/kanban'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

/** Build a `?a=b` query string from defined, non-empty params (URL-encoded). */
function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') sp.set(key, value)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Coerce a raw status string into the governed column vocabulary (else `todo`). */
function mapColumnName(v: unknown): KanbanColumnName {
  const s = str(v)
  if ((KANBAN_COLUMNS as readonly string[]).includes(s) || s === 'archived') {
    return s as KanbanColumnName
  }
  return 'todo'
}

/** Map a raw `task_runs`-shaped dict (board card worker, or drawer run) to {@link KanbanRun}. */
function mapRun(raw: unknown): KanbanRun {
  const r = rec(raw)
  return {
    id: num(r.id),
    profile: strOrNull(r.profile),
    status: strOrNull(r.status),
    outcome: strOrNull(r.outcome),
    summary: strOrNull(r.summary),
    startedAt: numOrNull(r.started_at),
    endedAt: numOrNull(r.ended_at),
  }
}

/** Map the plugin's compact card `warnings` summary (or null) to the DTO badge. */
function mapWarnings(raw: unknown): KanbanCard['warnings'] {
  if (!raw || typeof raw !== 'object') return null
  const w = rec(raw)
  return {
    count: num(w.count),
    highestSeverity: strOrNull(w.highest_severity),
  }
}

/** Map the plugin's derived `age` object (or missing) to the DTO. */
function mapAge(raw: unknown): KanbanCard['age'] {
  if (!raw || typeof raw !== 'object') return null
  const a = rec(raw)
  return {
    createdAgeSeconds: numOrNull(a.created_age_seconds),
    startedAgeSeconds: numOrNull(a.started_age_seconds),
    timeToCompleteSeconds: numOrNull(a.time_to_complete_seconds),
  }
}

/**
 * Map a raw plugin task dict into the slim {@link KanbanCard}. This is the security
 * boundary for a card: worker_pid, claim_lock, claim_expires, workspace_path,
 * idempotency_key, branch_name, etc. are NOT copied across.
 *
 * `worker` is populated only for cards in the `running` column — the plugin doesn't
 * embed the active run on the card, so the namespace/route enriches running cards
 * from `/workers/active`; on the plain card map it stays null (the drawer carries
 * full run history regardless).
 */
export function mapCard(raw: unknown): KanbanCard {
  const t = rec(raw)
  const linkCounts = rec(t.link_counts)
  const progressRaw = t.progress
  return {
    id: str(t.id),
    title: str(t.title),
    column: mapColumnName(t.status),
    assignee: strOrNull(t.assignee),
    priority: num(t.priority),
    latestSummary: strOrNull(t.latest_summary),
    createdAt: numOrNull(t.created_at),
    startedAt: numOrNull(t.started_at),
    completedAt: numOrNull(t.completed_at),
    age: mapAge(t.age),
    worker: null,
    commentCount: num(t.comment_count),
    linkCounts: { parents: num(linkCounts.parents), children: num(linkCounts.children) },
    progress:
      progressRaw && typeof progressRaw === 'object'
        ? { done: num(rec(progressRaw).done), total: num(rec(progressRaw).total) }
        : null,
    warnings: mapWarnings(t.warnings),
  }
}

/**
 * Map the plugin's `/board` response into the ordered {@link KanbanBoard}. The plugin
 * returns columns in upstream order already, but we re-key by name and rebuild in the
 * FIXED {@link KANBAN_COLUMNS} order (archived appended when present) so the wire shape
 * is deterministic regardless of upstream column-emission quirks.
 */
export function mapBoard(raw: unknown, board: string): KanbanBoard {
  const b = rec(raw)
  const rawColumns = Array.isArray(b.columns) ? b.columns : []
  const byName = new Map<string, unknown[]>()
  for (const col of rawColumns) {
    const c = rec(col)
    const name = str(c.name)
    const tasks = Array.isArray(c.tasks) ? c.tasks : []
    byName.set(name, tasks)
  }
  const ordered: KanbanColumnName[] = [...KANBAN_COLUMNS]
  if (byName.has('archived')) ordered.push('archived')
  const columns: KanbanColumn[] = ordered.map((name) => ({
    name,
    cards: (byName.get(name) ?? []).map(mapCard),
  }))
  const assignees = Array.isArray(b.assignees)
    ? b.assignees.filter((a): a is string => typeof a === 'string')
    : []
  return {
    board,
    columns,
    assignees,
    cursor: num(b.latest_event_id),
    now: num(b.now),
  }
}

/** Map the plugin's `/tasks/:id` response into {@link KanbanTask}. */
export function mapTask(raw: unknown): KanbanTask {
  const d = rec(raw)
  const taskDict = rec(d.task)
  const card = mapCard(taskDict)
  const runs = Array.isArray(d.runs) ? d.runs.map(mapRun) : []
  // If the task is running, surface its active (unended) run on the card's worker slot.
  if (card.column === 'running') {
    const active = runs.find((r) => r.endedAt === null) ?? runs[runs.length - 1] ?? null
    card.worker = active
  }
  const links = rec(d.links)
  return {
    card,
    body: strOrNull(taskDict.body),
    latestSummary: strOrNull(taskDict.latest_summary),
    comments: (Array.isArray(d.comments) ? d.comments : []).map((c) => {
      const cc = rec(c)
      return {
        id: num(cc.id),
        author: strOrNull(cc.author),
        body: str(cc.body),
        createdAt: numOrNull(cc.created_at),
      }
    }),
    events: (Array.isArray(d.events) ? d.events : []).map((e) => {
      const ee = rec(e)
      return { id: num(ee.id), kind: str(ee.kind), createdAt: numOrNull(ee.created_at) }
    }),
    runs,
    links: {
      parents: (Array.isArray(links.parents) ? links.parents : []).filter(
        (x): x is string => typeof x === 'string',
      ),
      children: (Array.isArray(links.children) ? links.children : []).filter(
        (x): x is string => typeof x === 'string',
      ),
    },
  }
}

/** Map the plugin's `/workers/active` response into {@link KanbanWorkers}. */
export function mapWorkers(raw: unknown): KanbanWorkers {
  const d = rec(raw)
  const workers = (Array.isArray(d.workers) ? d.workers : []).map((w) => {
    const ww = rec(w)
    return {
      runId: num(ww.run_id),
      taskId: str(ww.task_id),
      taskTitle: strOrNull(ww.task_title),
      assignee: strOrNull(ww.task_assignee),
      profile: strOrNull(ww.profile),
      startedAt: numOrNull(ww.started_at),
      lastHeartbeatAt: numOrNull(ww.last_heartbeat_at),
    }
  })
  return { workers, count: workers.length, checkedAt: num(d.checked_at) }
}

/** Map the plugin's `/stats` response into {@link KanbanStats}. */
export function mapStats(raw: unknown): KanbanStats {
  const d = rec(raw)
  const byStatusRaw = rec(d.by_status)
  const byStatus: Record<string, number> = {}
  for (const [k, v] of Object.entries(byStatusRaw)) byStatus[k] = num(v)
  const byAssignee: Record<string, Record<string, number>> = {}
  for (const [name, counts] of Object.entries(rec(d.by_assignee))) {
    const inner: Record<string, number> = {}
    for (const [k, v] of Object.entries(rec(counts))) inner[k] = num(v)
    byAssignee[name] = inner
  }
  return {
    byStatus,
    byAssignee,
    oldestReadyAgeSeconds: numOrNull(d.oldest_ready_age_seconds),
    now: num(d.now),
  }
}

/** Map the plugin's `/boards` response into {@link KanbanBoardList}. */
export function mapBoardList(raw: unknown): KanbanBoardList {
  const d = rec(raw)
  const boards = (Array.isArray(d.boards) ? d.boards : []).map((b) => {
    const bb = rec(b)
    const counts: Record<string, number> = {}
    for (const [k, v] of Object.entries(rec(bb.counts))) counts[k] = num(v)
    return {
      slug: str(bb.slug),
      name: str(bb.name) || str(bb.slug),
      description: str(bb.description),
      icon: str(bb.icon),
      color: str(bb.color),
      isCurrent: bb.is_current === true,
      total: num(bb.total),
      counts,
    }
  })
  return { boards, current: str(d.current) || 'default' }
}

/** Coerce a value to a list of bare task-id strings (drops the `spawned` triples'
 *  host fields — only the task id of each `(task_id, assignee, workspace_path)`). */
function idsFromTriples(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') ids.push(entry)
    else if (Array.isArray(entry) && typeof entry[0] === 'string') ids.push(entry[0])
  }
  return ids
}

/** Coerce a value to a list of plain id strings. */
function idList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Map the plugin's `/dispatch` `DispatchResult` dict into the slim, host-free
 * {@link KanbanDispatchResult}. The upstream `spawned` is a list of `(task_id,
 * assignee, workspace_path)` triples — only the task ids cross; workspace paths,
 * per-profile-cap tuples, and the other host-shaped buckets are dropped.
 */
export function mapDispatchResult(raw: unknown): KanbanDispatchResult {
  const d = rec(raw)
  const spawnedIds = idsFromTriples(d.spawned)
  return {
    spawned: spawnedIds.length,
    spawnedIds,
    promoted: num(d.promoted),
    reclaimed: num(d.reclaimed),
    skippedUnassigned: idList(d.skipped_unassigned),
  }
}

/**
 * True when an upstream failure means "the kanban plugin is not installed/enabled on
 * this hermes" — i.e. the `/api/plugins/kanban/*` route does not exist (404). That is
 * the graceful-degrade signal; anything else (502, timeout, 500) is a real error the
 * route surfaces honestly.
 */
function isPluginAbsent(err: unknown): boolean {
  return err instanceof DashboardError && err.status === 404
}

/**
 * A 409 from the plugin means a benign-but-real CONFLICT, not a server fault: the
 * run already ended, or the task is no longer in a reclaimable/reassignable state.
 * The plugin's `{ detail }` body isn't carried on {@link DashboardError} (only the
 * status), so the BFF answers this honestly with a fixed, action-specific reason
 * rather than fabricating the upstream wording or treating it as a 502.
 */
function isConflict(err: unknown): boolean {
  return err instanceof DashboardError && err.status === 409
}

export class KanbanClient {
  constructor(private readonly dashboard: KanbanDashboard) {}

  private path(suffix: string, board?: string): string {
    return `${KANBAN_BASE}${suffix}${buildQuery({ board })}`
  }

  /**
   * Fetch + map a single plugin endpoint, wrapping the result in the availability
   * envelope. A 404 (plugin absent) degrades to `{ available: false }`; any other
   * upstream error propagates so the route can map it to a 502.
   */
  private async fetchAvailable<T>(
    path: string,
    map: (raw: unknown) => T,
  ): Promise<{ available: false } | { available: true; data: T }> {
    try {
      const raw = await this.dashboard.getJson<unknown>(path)
      return { available: true, data: map(raw) }
    } catch (err) {
      if (isPluginAbsent(err)) return { available: false }
      throw err
    }
  }

  /** Full board for `board` (active board when omitted), columns in fixed order. */
  async board(board?: string): Promise<KanbanBoardResponse> {
    // Fetch the board and its active workers in PARALLEL (the workers list only
    // needs the same slug, not the board result), halving this call's latency on
    // the 4s board poll. A workers failure must NOT fail the board, so it's caught
    // to null and running cards just keep worker=null.
    const [result, workersRaw] = await Promise.all([
      this.fetchAvailable(this.path('/board', board), (raw) => mapBoard(raw, board ?? 'default')),
      this.dashboard.getJson<unknown>(this.path('/workers/active', board)).catch(() => null),
    ])
    // Enrich running cards with their active run so the UI shows worker info
    // without a per-card round-trip.
    if (result.available && workersRaw !== null) {
      try {
        const byTask = new Map<string, KanbanRun>()
        for (const w of mapWorkers(workersRaw).workers) {
          byTask.set(w.taskId, {
            id: w.runId,
            profile: w.profile,
            status: 'running',
            outcome: null,
            summary: null,
            startedAt: w.startedAt,
            endedAt: null,
          })
        }
        for (const col of result.data.columns) {
          if (col.name !== 'running') continue
          for (const card of col.cards) card.worker = byTask.get(card.id) ?? null
        }
      } catch {
        // Best-effort enrichment only.
      }
    }
    return result
  }

  /** Multi-project board list + the active slug. */
  async boards(): Promise<KanbanBoardListResponse> {
    return this.fetchAvailable(this.path('/boards'), mapBoardList)
  }

  /** Full task detail for the drawer (comments, events, runs, links). */
  async task(id: string, board?: string): Promise<KanbanTaskResponse> {
    return this.fetchAvailable(this.path(`/tasks/${encodeURIComponent(id)}`, board), mapTask)
  }

  /** The active-workers strip. */
  async workers(board?: string): Promise<KanbanWorkersResponse> {
    return this.fetchAvailable(this.path('/workers/active', board), mapWorkers)
  }

  /** The board HUD stats. */
  async stats(board?: string): Promise<KanbanStatsResponse> {
    return this.fetchAvailable(this.path('/stats', board), mapStats)
  }

  /* ---------------------------------------------------------------------- */
  /* Mutations — the WRITABLE cut. Each maps 1:1 onto a real stock plugin    */
  /* route (see knownHermesRoutes.ts cites). Unlike the reads, a mutation    */
  /* does NOT degrade a missing plugin to an envelope — it throws (the route */
  /* surfaces 404→502/honest error), because the UI only ever offers writes  */
  /* when the board itself is `available` already.                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Create a task. Proxies `POST /api/plugins/kanban/tasks` (plugin_api.py:586)
   * and returns just the new card's id (the slim contract — the board refetch
   * carries the full card). The upstream returns `{ task: {...}, warning? }`; an
   * absent/odd id surfaces as an empty string the route can treat as a failure.
   */
  async createTask(input: KanbanCreateTaskInput, board?: string): Promise<KanbanCreateTaskResult> {
    const raw = await this.dashboard.postJson<unknown>(this.path('/tasks', board), {
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    })
    const task = rec(rec(raw).task)
    return { id: str(task.id) }
  }

  /**
   * Move ONE card to a new column. Proxies the bulk route `POST
   * /api/plugins/kanban/tasks/bulk` (plugin_api.py:1148) with a single id, and
   * reads back the per-id outcome: a refused transition comes back `{ ok: false,
   * error }` (e.g. "transition to 'ready' refused" when parents aren't done) so
   * the UI can roll the optimistic move back AND show the real reason — never a
   * fake success.
   */
  async moveTask(
    id: string,
    input: KanbanMoveTaskInput,
    board?: string,
  ): Promise<KanbanMoveTaskResult> {
    const raw = await this.dashboard.postJson<unknown>(this.path('/tasks/bulk', board), {
      ids: [id],
      status: input.status,
    })
    const results = Array.isArray(rec(raw).results) ? (rec(raw).results as unknown[]) : []
    const entry = rec(results.find((r) => str(rec(r).id) === id) ?? results[0])
    const ok = entry.ok === true
    return { ok, error: ok ? null : (strOrNull(entry.error) ?? 'Move was refused') }
  }

  /**
   * Add a comment to a task. Proxies `POST
   * /api/plugins/kanban/tasks/{id}/comments` (plugin_api.py:1078). Upstream
   * returns `{ ok: true }`; a 404 (task gone) / 400 (empty body) throws so the
   * route maps it honestly.
   */
  async addComment(
    id: string,
    input: KanbanCommentInput,
    board?: string,
  ): Promise<KanbanCommentResult> {
    const raw = await this.dashboard.postJson<unknown>(
      this.path(`/tasks/${encodeURIComponent(id)}/comments`, board),
      { body: input.body },
    )
    return { ok: rec(raw).ok === true }
  }

  /* ---------------------------------------------------------------------- */
  /* Orchestration — the run-control cut. These DRIVE agent work rather than */
  /* just reading it. Each maps 1:1 onto a real stock plugin route (cites in */
  /* knownHermesRoutes.ts). dispatch throws on any upstream failure (it's a  */
  /* fire-and-report nudge); terminate/reassign map a benign 409 CONFLICT to */
  /* an HONEST `{ ok: false, error }` (the worker already finished / the task */
  /* changed state) instead of a 502, so the UI stays calm and truthful.     */
  /* ---------------------------------------------------------------------- */

  /**
   * Nudge the dispatcher to spawn workers for `ready` tasks NOW (rather than
   * waiting for its periodic tick). Proxies `POST /api/plugins/kanban/dispatch`
   * (plugin_api.py:1944) and returns the slim, host-free tally so the UI can say
   * honestly how many tasks actually got a worker (which may be zero when every
   * profile is at capacity — the dispatcher is best-effort, not a guarantee).
   */
  async dispatch(board?: string): Promise<KanbanDispatchResult> {
    const raw = await this.dashboard.postJson<unknown>(this.path('/dispatch', board), {})
    return mapDispatchResult(raw)
  }

  /**
   * Terminate the worker process backing an in-flight RUN (keyed on run_id, which
   * the running card already carries). Proxies `POST
   * /api/plugins/kanban/runs/{run_id}/terminate` (plugin_api.py:1494). A 409 means
   * the run already ended or the task is no longer reclaimable — surfaced as
   * `{ ok: false }` (the work likely finished on its own), not an error.
   */
  async terminateRun(input: KanbanTerminateInput, board?: string): Promise<KanbanTerminateResult> {
    try {
      const raw = await this.dashboard.postJson<unknown>(
        this.path(`/runs/${encodeURIComponent(String(input.runId))}/terminate`, board),
        { ...(input.reason !== undefined ? { reason: input.reason } : {}) },
      )
      const r = rec(raw)
      return { ok: r.ok === true, taskId: strOrNull(r.task_id), error: null }
    } catch (err) {
      if (isConflict(err)) {
        return { ok: false, taskId: null, error: 'The run already ended.' }
      }
      throw err
    }
  }

  /**
   * Reassign a task to a different worker `profile` (empty/omitted unassigns). When
   * `reclaimFirst` is set the upstream releases an active claim before reassigning —
   * required to reassign a still-running task. Proxies `POST
   * /api/plugins/kanban/tasks/{id}/reassign` (plugin_api.py:1641). A 409 (unknown id,
   * or running without reclaim) becomes an HONEST `{ ok: false }`.
   */
  async reassignTask(
    id: string,
    input: KanbanReassignInput,
    board?: string,
  ): Promise<KanbanReassignResult> {
    try {
      const raw = await this.dashboard.postJson<unknown>(
        this.path(`/tasks/${encodeURIComponent(id)}/reassign`, board),
        {
          profile: input.profile ?? '',
          ...(input.reclaimFirst !== undefined ? { reclaim_first: input.reclaimFirst } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
      )
      const r = rec(raw)
      return { ok: r.ok === true, assignee: strOrNull(r.assignee), error: null }
    } catch (err) {
      if (isConflict(err)) {
        return {
          ok: false,
          assignee: null,
          error: 'Could not reassign: the task is unknown, or still running.',
        }
      }
      throw err
    }
  }
}
