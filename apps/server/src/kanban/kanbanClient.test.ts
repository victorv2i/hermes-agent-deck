import { describe, it, expect } from 'vitest'
import {
  KanbanClient,
  mapBoard,
  mapCard,
  mapTask,
  mapWorkers,
  mapStats,
  mapBoardList,
  mapDispatchResult,
  type KanbanDashboard,
} from './kanbanClient'
import { DashboardError } from '../hermes/dashboardClient'
import { KANBAN_COLUMNS } from '@agent-deck/protocol'

/** A raw plugin task dict (superset, as the kanban plugin returns it on /board). */
const RAW_TASK = {
  id: 't_ab12',
  title: 'Ship the thing',
  status: 'running',
  assignee: 'builder',
  priority: 5,
  latest_summary: 'working on it',
  created_at: 1_700_000_000,
  started_at: 1_700_000_100,
  completed_at: null,
  age: { created_age_seconds: 200, started_age_seconds: 100, time_to_complete_seconds: null },
  link_counts: { parents: 0, children: 3 },
  comment_count: 2,
  progress: { done: 1, total: 3 },
  warnings: { count: 1, kinds: { stuck: 1 }, latest_at: 5, highest_severity: 'warning' },
  // Host/filesystem-shaped fields that MUST NOT cross the boundary:
  worker_pid: 9999,
  claim_lock: 'lock-abc',
  claim_expires: 1_700_009_999,
  workspace_path: '/home/operator/secret-project',
  idempotency_key: 'idem-xyz',
  branch_name: 'feat/secret',
}

const RAW_BOARD = {
  columns: KANBAN_COLUMNS.map((name) => ({
    name,
    tasks: name === 'running' ? [RAW_TASK] : [],
  })),
  tenants: [],
  assignees: ['builder'],
  latest_event_id: 99,
  now: 1_700_000_300,
}

function fakeDashboard(opts: {
  getJson?: (path: string) => Promise<unknown>
  postJson?: (path: string, body: unknown) => Promise<unknown>
}): {
  dash: KanbanDashboard
  paths: string[]
  posts: { path: string; body: unknown }[]
} {
  const paths: string[] = []
  const posts: { path: string; body: unknown }[] = []
  const dash: KanbanDashboard = {
    getJson: async <T>(path: string) => {
      paths.push(path)
      return (await (opts.getJson?.(path) ?? Promise.resolve({}))) as T
    },
    postJson: async <T>(path: string, body: unknown) => {
      posts.push({ path, body })
      return (await (opts.postJson?.(path, body) ?? Promise.resolve({}))) as T
    },
    authedFetch: async () => Response.json({}),
  }
  return { dash, paths, posts }
}

describe('mapCard', () => {
  it('maps a raw task into the slim KanbanCard shape', () => {
    const card = mapCard(RAW_TASK)
    expect(card).toMatchObject({
      id: 't_ab12',
      title: 'Ship the thing',
      column: 'running',
      assignee: 'builder',
      priority: 5,
      latestSummary: 'working on it',
      commentCount: 2,
      linkCounts: { parents: 0, children: 3 },
      progress: { done: 1, total: 3 },
      warnings: { count: 1, highestSeverity: 'warning' },
    })
  })

  it('NEVER leaks host/filesystem/internal fields across the boundary', () => {
    const card = mapCard(RAW_TASK) as Record<string, unknown>
    for (const leak of [
      'worker_pid',
      'claim_lock',
      'claim_expires',
      'workspace_path',
      'idempotency_key',
      'branch_name',
      'tenant',
    ]) {
      expect(card).not.toHaveProperty(leak)
    }
  })

  it('buckets an unknown status into todo', () => {
    expect(mapCard({ ...RAW_TASK, status: 'weird' }).column).toBe('todo')
  })
})

describe('mapBoard', () => {
  it('emits columns in the FIXED order regardless of input order', () => {
    const shuffled = { ...RAW_BOARD, columns: [...RAW_BOARD.columns].reverse() }
    const board = mapBoard(shuffled, 'default')
    expect(board.columns.map((c) => c.name)).toEqual([...KANBAN_COLUMNS])
  })

  it('carries the cursor (latest_event_id) and now', () => {
    const board = mapBoard(RAW_BOARD, 'default')
    expect(board.cursor).toBe(99)
    expect(board.now).toBe(1_700_000_300)
    expect(board.board).toBe('default')
  })

  it('appends an archived column only when present', () => {
    const withArchived = {
      ...RAW_BOARD,
      columns: [...RAW_BOARD.columns, { name: 'archived', tasks: [] }],
    }
    expect(mapBoard(withArchived, 'default').columns.at(-1)?.name).toBe('archived')
    expect(mapBoard(RAW_BOARD, 'default').columns.some((c) => c.name === 'archived')).toBe(false)
  })
})

describe('mapTask / mapWorkers / mapStats / mapBoardList', () => {
  it('maps a task detail and surfaces the active run on a running card', () => {
    const detail = mapTask({
      task: RAW_TASK,
      comments: [{ id: 1, author: 'op', body: 'hi', created_at: 1 }],
      events: [{ id: 1, kind: 'status', created_at: 1 }],
      attachments: [{ id: 1, stored_path: '/secret/x', filename: 'x' }],
      links: { parents: ['t_p'], children: ['t_c'] },
      runs: [
        {
          id: 7,
          profile: 'builder',
          status: 'ended',
          outcome: 'completed',
          summary: 'old',
          started_at: 1,
          ended_at: 2,
        },
        {
          id: 8,
          profile: 'builder',
          status: 'running',
          outcome: null,
          summary: null,
          started_at: 3,
          ended_at: null,
        },
      ],
    })
    expect(detail.card.worker?.id).toBe(8)
    expect(detail.links.children).toEqual(['t_c'])
    expect(detail.body).toBeNull()
    // attachments stored_path never crosses the boundary
    expect(JSON.stringify(detail)).not.toContain('/secret/x')
  })

  it('maps active workers', () => {
    const w = mapWorkers({
      workers: [
        {
          run_id: 8,
          task_id: 't_ab12',
          task_title: 'Ship the thing',
          task_assignee: 'builder',
          profile: 'builder',
          worker_pid: 9999,
          started_at: 3,
          last_heartbeat_at: 4,
        },
      ],
      count: 1,
      checked_at: 5,
    })
    expect(w.workers[0]).toMatchObject({ runId: 8, taskId: 't_ab12', assignee: 'builder' })
    expect(w.workers[0] as Record<string, unknown>).not.toHaveProperty('worker_pid')
  })

  it('maps stats', () => {
    const s = mapStats({
      by_status: { running: 1, done: 4 },
      by_assignee: { builder: { running: 1 } },
      oldest_ready_age_seconds: null,
      now: 5,
    })
    expect(s.byStatus.done).toBe(4)
    expect(s.byAssignee.builder?.running).toBe(1)
  })

  it('maps a board list', () => {
    const list = mapBoardList({
      boards: [
        {
          slug: 'default',
          name: 'Default',
          description: '',
          icon: '',
          color: '',
          is_current: true,
          total: 5,
          counts: { running: 1 },
        },
      ],
      current: 'default',
    })
    expect(list.current).toBe('default')
    expect(list.boards[0]?.isCurrent).toBe(true)
  })
})

describe('KanbanClient — proxy + routing', () => {
  it('requests /board (+ workers enrichment) and maps it', async () => {
    const { dash, paths } = fakeDashboard({
      getJson: async (p) => {
        if (p.startsWith('/api/plugins/kanban/board')) return RAW_BOARD
        if (p.startsWith('/api/plugins/kanban/workers/active'))
          return {
            workers: [
              {
                run_id: 8,
                task_id: 't_ab12',
                profile: 'builder',
                started_at: 3,
                last_heartbeat_at: 4,
              },
            ],
            count: 1,
            checked_at: 5,
          }
        return {}
      },
    })
    const res = await new KanbanClient(dash).board()
    expect(res.available).toBe(true)
    if (!res.available) throw new Error('unreachable')
    const running = res.data.columns.find((c) => c.name === 'running')!
    expect(running.cards[0]?.worker?.id).toBe(8)
    expect(paths.some((p) => p.startsWith('/api/plugins/kanban/board'))).toBe(true)
    expect(paths.some((p) => p.startsWith('/api/plugins/kanban/workers/active'))).toBe(true)
  })

  it('forwards the board slug as ?board=', async () => {
    const { dash, paths } = fakeDashboard({ getJson: async () => RAW_BOARD })
    await new KanbanClient(dash).board('proj-x')
    expect(paths[0]).toContain('board=proj-x')
  })

  it('still returns the board when the workers enrichment fetch fails', async () => {
    const { dash } = fakeDashboard({
      getJson: async (p) => {
        if (p.startsWith('/api/plugins/kanban/board')) return RAW_BOARD
        throw new DashboardError('workers boom', 500)
      },
    })
    const res = await new KanbanClient(dash).board()
    expect(res.available).toBe(true)
    if (!res.available) throw new Error('unreachable')
    expect(res.data.columns.find((c) => c.name === 'running')!.cards[0]?.worker).toBeNull()
  })
})

describe('KanbanClient — graceful degrade (portability)', () => {
  it('returns { available: false } when the plugin route 404s', async () => {
    const { dash } = fakeDashboard({
      getJson: async () => {
        throw new DashboardError('GET /api/plugins/kanban/board failed: HTTP 404', 404)
      },
    })
    const client = new KanbanClient(dash)
    expect(await client.board()).toEqual({ available: false })
    expect(await client.boards()).toEqual({ available: false })
    expect(await client.task('t_1')).toEqual({ available: false })
    expect(await client.workers()).toEqual({ available: false })
    expect(await client.stats()).toEqual({ available: false })
  })

  it('propagates a non-404 upstream error (real failure, NOT degrade)', async () => {
    const { dash } = fakeDashboard({
      getJson: async () => {
        throw new DashboardError('upstream boom', 502)
      },
    })
    await expect(new KanbanClient(dash).boards()).rejects.toBeInstanceOf(DashboardError)
  })
})

describe('KanbanClient mutations — wired to REAL stock routes', () => {
  it('createTask POSTs /tasks with the slim body and returns the new id', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ task: { id: 't_new', title: 'T', status: 'todo' } }),
    })
    const result = await new KanbanClient(dash).createTask(
      { title: 'T', body: 'desc', assignee: 'builder', priority: 3 },
      'proj',
    )
    expect(result).toEqual({ id: 't_new' })
    expect(posts).toHaveLength(1)
    expect(posts[0]!.path).toBe('/api/plugins/kanban/tasks?board=proj')
    expect(posts[0]!.body).toEqual({ title: 'T', body: 'desc', assignee: 'builder', priority: 3 })
  })

  it('createTask omits undefined optional fields from the body', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ task: { id: 't_min' } }),
    })
    await new KanbanClient(dash).createTask({ title: 'Only title' })
    expect(posts[0]!.body).toEqual({ title: 'Only title' })
    expect(posts[0]!.path).toBe('/api/plugins/kanban/tasks')
  })

  it('moveTask POSTs /tasks/bulk for a single id and reports ok on success', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ results: [{ id: 't_1', ok: true }] }),
    })
    const result = await new KanbanClient(dash).moveTask('t_1', { status: 'ready' }, 'proj')
    expect(result).toEqual({ ok: true, error: null })
    expect(posts[0]!.path).toBe('/api/plugins/kanban/tasks/bulk?board=proj')
    expect(posts[0]!.body).toEqual({ ids: ['t_1'], status: 'ready' })
  })

  it('moveTask surfaces the upstream per-id refusal reason (honest rollback)', async () => {
    const { dash } = fakeDashboard({
      postJson: async () => ({
        results: [{ id: 't_1', ok: false, error: "transition to 'ready' refused" }],
      }),
    })
    const result = await new KanbanClient(dash).moveTask('t_1', { status: 'ready' })
    expect(result).toEqual({ ok: false, error: "transition to 'ready' refused" })
  })

  it('moveTask falls back to a generic reason when upstream omits the error text', async () => {
    const { dash } = fakeDashboard({
      postJson: async () => ({ results: [{ id: 't_1', ok: false }] }),
    })
    const result = await new KanbanClient(dash).moveTask('t_1', { status: 'todo' })
    expect(result).toEqual({ ok: false, error: 'Move was refused' })
  })

  it('addComment POSTs /tasks/:id/comments and returns ok', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ ok: true }),
    })
    const result = await new KanbanClient(dash).addComment('t 1', { body: 'looks good' }, 'proj')
    expect(result).toEqual({ ok: true })
    expect(posts[0]!.path).toBe('/api/plugins/kanban/tasks/t%201/comments?board=proj')
    expect(posts[0]!.body).toEqual({ body: 'looks good' })
  })

  it('a mutation propagates a real upstream failure (no fake success)', async () => {
    const { dash } = fakeDashboard({
      postJson: async () => {
        throw new DashboardError('POST /tasks failed: HTTP 502', 502)
      },
    })
    await expect(new KanbanClient(dash).createTask({ title: 'x' })).rejects.toBeInstanceOf(
      DashboardError,
    )
  })
})

describe('mapDispatchResult — slim, host-free dispatch tally', () => {
  it('counts spawned triples and keeps only the task ids (drops workspace paths)', () => {
    const raw = {
      reclaimed: 1,
      promoted: 2,
      spawned: [
        ['t_a', 'builder', '/home/op/secret-a'],
        ['t_b', 'builder', '/home/op/secret-b'],
      ],
      skipped_unassigned: ['t_c'],
      skipped_per_profile_capped: [['t_d', 'builder', 3]],
    }
    const result = mapDispatchResult(raw)
    expect(result).toEqual({
      spawned: 2,
      spawnedIds: ['t_a', 't_b'],
      promoted: 2,
      reclaimed: 1,
      skippedUnassigned: ['t_c'],
    })
    // The workspace path (host internal) never crosses.
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('handles an empty / missing dispatch result safely', () => {
    expect(mapDispatchResult({})).toEqual({
      spawned: 0,
      spawnedIds: [],
      promoted: 0,
      reclaimed: 0,
      skippedUnassigned: [],
    })
  })
})

describe('KanbanClient orchestration — wired to REAL stock routes', () => {
  it('dispatch POSTs /dispatch (with board) and returns the slim tally', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ spawned: [['t_1', 'b', '/p']], promoted: 0, reclaimed: 0 }),
    })
    const result = await new KanbanClient(dash).dispatch('proj')
    expect(posts[0]!.path).toBe('/api/plugins/kanban/dispatch?board=proj')
    expect(result.spawned).toBe(1)
    expect(result.spawnedIds).toEqual(['t_1'])
  })

  it('terminateRun POSTs /runs/:runId/terminate and returns ok + task id', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ ok: true, run_id: 42, task_id: 't_9' }),
    })
    const result = await new KanbanClient(dash).terminateRun({ runId: 42, reason: 'stuck' }, 'proj')
    expect(posts[0]!.path).toBe('/api/plugins/kanban/runs/42/terminate?board=proj')
    expect(posts[0]!.body).toEqual({ reason: 'stuck' })
    expect(result).toEqual({ ok: true, taskId: 't_9', error: null })
  })

  it('terminateRun maps a 409 (run already ended) to an HONEST ok:false, not a throw', async () => {
    const { dash } = fakeDashboard({
      postJson: async () => {
        throw new DashboardError('POST terminate failed: HTTP 409', 409)
      },
    })
    const result = await new KanbanClient(dash).terminateRun({ runId: 7 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already ended/i)
  })

  it('terminateRun propagates a real (non-409) upstream failure', async () => {
    const { dash } = fakeDashboard({
      postJson: async () => {
        throw new DashboardError('boom', 502)
      },
    })
    await expect(new KanbanClient(dash).terminateRun({ runId: 7 })).rejects.toBeInstanceOf(
      DashboardError,
    )
  })

  it('reassignTask POSTs /tasks/:id/reassign with reclaim_first and returns the assignee', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ ok: true, task_id: 't_1', assignee: 'smart' }),
    })
    const result = await new KanbanClient(dash).reassignTask(
      't_1',
      { profile: 'smart', reclaimFirst: true },
      'proj',
    )
    expect(posts[0]!.path).toBe('/api/plugins/kanban/tasks/t_1/reassign?board=proj')
    expect(posts[0]!.body).toEqual({ profile: 'smart', reclaim_first: true })
    expect(result).toEqual({ ok: true, assignee: 'smart', error: null })
  })

  it('reassignTask sends an empty profile to unassign', async () => {
    const { dash, posts } = fakeDashboard({
      postJson: async () => ({ ok: true, task_id: 't_1', assignee: null }),
    })
    await new KanbanClient(dash).reassignTask('t_1', {})
    expect(posts[0]!.body).toEqual({ profile: '' })
  })

  it('reassignTask maps a 409 (still running / unknown) to an HONEST ok:false', async () => {
    const { dash } = fakeDashboard({
      postJson: async () => {
        throw new DashboardError('POST reassign failed: HTTP 409', 409)
      },
    })
    const result = await new KanbanClient(dash).reassignTask('t_1', { profile: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/unknown|still running/i)
  })
})
