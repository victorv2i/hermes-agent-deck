import { describe, it, expect, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerKanbanRoutes } from './kanbanRoutes'
import { DashboardError } from '../hermes/dashboardClient'
import type { KanbanClient } from './kanbanClient'
import {
  KANBAN_COLUMNS,
  type KanbanBoard,
  type KanbanBoardResponse,
  type KanbanWorkersResponse,
} from '@agent-deck/protocol'

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
  vi.restoreAllMocks()
})

const BOARD: KanbanBoard = {
  board: 'default',
  columns: KANBAN_COLUMNS.map((name) => ({ name, cards: [] })),
  assignees: ['builder'],
  cursor: 99,
  now: 1_700_000_300,
}

async function buildWith(client: Partial<KanbanClient>): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  await instance.register(registerKanbanRoutes, { kanbanClient: client as KanbanClient })
  await instance.ready()
  return instance
}

describe('GET /api/agent-deck/kanban/board', () => {
  it('returns the available board envelope', async () => {
    const board = vi.fn(
      async (): Promise<KanbanBoardResponse> => ({ available: true, data: BOARD }),
    )
    app = await buildWith({ board })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/kanban/board' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: true, data: BOARD })
    expect(board).toHaveBeenCalledWith(undefined)
  })

  it('forwards ?board= to the client', async () => {
    const board = vi.fn(
      async (): Promise<KanbanBoardResponse> => ({ available: true, data: BOARD }),
    )
    app = await buildWith({ board })
    await app.inject({ method: 'GET', url: '/api/agent-deck/kanban/board?board=proj' })
    expect(board).toHaveBeenCalledWith('proj')
  })

  it('returns { available: false } (200, NOT 500) when the plugin is absent', async () => {
    const board = vi.fn(async (): Promise<KanbanBoardResponse> => ({ available: false }))
    app = await buildWith({ board })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/kanban/board' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: false })
  })

  it('maps a REAL upstream failure to 502 without leaking internals', async () => {
    app = await buildWith({
      board: async () => {
        throw new DashboardError('GET /api/plugins/kanban/board failed: HTTP 502', 502)
      },
    })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/kanban/board' })
    expect(res.statusCode).toBe(502)
    const body = res.json() as { error: string }
    expect(body.error).toBe('Upstream dashboard error')
    expect(JSON.stringify(body)).not.toContain('HTTP 502')
  })
})

describe('GET /api/agent-deck/kanban/{boards,tasks/:id,workers/active,stats}', () => {
  it('proxies the boards list', async () => {
    const boards = vi.fn(async () => ({ available: false }) as const)
    app = await buildWith({ boards })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/kanban/boards' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: false })
  })

  it('proxies a task detail with the id + board', async () => {
    const task = vi.fn(async () => ({ available: false }) as const)
    app = await buildWith({ task })
    await app.inject({ method: 'GET', url: '/api/agent-deck/kanban/tasks/t_ab12?board=proj' })
    expect(task).toHaveBeenCalledWith('t_ab12', 'proj')
  })

  it('proxies active workers', async () => {
    const workers = vi.fn(
      async (): Promise<KanbanWorkersResponse> => ({
        available: true,
        data: { workers: [], count: 0, checkedAt: 5 },
      }),
    )
    app = await buildWith({ workers })
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/kanban/workers/active',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ available: true, data: { count: 0 } })
  })

  it('proxies stats', async () => {
    const stats = vi.fn(async () => ({ available: false }) as const)
    app = await buildWith({ stats })
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/kanban/stats?board=proj' })
    expect(res.statusCode).toBe(200)
    expect(stats).toHaveBeenCalledWith('proj')
  })
})

describe('POST /api/agent-deck/kanban/tasks (create)', () => {
  it('validates + proxies the create, forwarding ?board=', async () => {
    const createTask = vi.fn(async () => ({ id: 't_new' }))
    app = await buildWith({ createTask })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks?board=proj',
      payload: { title: 'Build it', assignee: 'builder' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: 't_new' })
    expect(createTask).toHaveBeenCalledWith({ title: 'Build it', assignee: 'builder' }, 'proj')
  })

  it('rejects an empty title with 400 (does NOT call upstream)', async () => {
    const createTask = vi.fn(async () => ({ id: 't_new' }))
    app = await buildWith({ createTask })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks',
      payload: { title: '   ' },
    })
    expect(res.statusCode).toBe(400)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('maps a real upstream failure to 502 without leaking internals', async () => {
    app = await buildWith({
      createTask: async () => {
        throw new DashboardError('POST /tasks failed: HTTP 502', 502)
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks',
      payload: { title: 'x' },
    })
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.json())).not.toContain('HTTP 502')
  })
})

describe('POST /api/agent-deck/kanban/tasks/:id/move', () => {
  it('proxies a valid move and returns the ok result', async () => {
    const moveTask = vi.fn(async () => ({ ok: true, error: null }))
    app = await buildWith({ moveTask })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/move?board=proj',
      payload: { status: 'ready' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, error: null })
    expect(moveTask).toHaveBeenCalledWith('t_1', { status: 'ready' }, 'proj')
  })

  it('rejects a non-target column (running/review) with 400', async () => {
    const moveTask = vi.fn(async () => ({ ok: true, error: null }))
    app = await buildWith({ moveTask })
    for (const status of ['running', 'review', 'archived', 'nonsense']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-deck/kanban/tasks/t_1/move',
        payload: { status },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(moveTask).not.toHaveBeenCalled()
  })

  it('passes through an HONEST refusal (200 ok:false + reason) for rollback', async () => {
    const moveTask = vi.fn(async () => ({ ok: false, error: "transition to 'ready' refused" }))
    app = await buildWith({ moveTask })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/move',
      payload: { status: 'ready' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, error: "transition to 'ready' refused" })
  })
})

describe('POST /api/agent-deck/kanban/tasks/:id/comments', () => {
  it('validates + proxies a comment', async () => {
    const addComment = vi.fn(async () => ({ ok: true }))
    app = await buildWith({ addComment })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/comments?board=proj',
      payload: { body: 'looks good' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(addComment).toHaveBeenCalledWith('t_1', { body: 'looks good' }, 'proj')
  })

  it('rejects an empty comment with 400', async () => {
    const addComment = vi.fn(async () => ({ ok: true }))
    app = await buildWith({ addComment })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/comments',
      payload: { body: '   ' },
    })
    expect(res.statusCode).toBe(400)
    expect(addComment).not.toHaveBeenCalled()
  })
})

describe('POST /api/agent-deck/kanban/dispatch (orchestration)', () => {
  it('nudges the dispatcher and returns the slim tally', async () => {
    const dispatch = vi.fn(async () => ({
      spawned: 1,
      spawnedIds: ['t_1'],
      promoted: 0,
      reclaimed: 0,
      skippedUnassigned: [],
    }))
    app = await buildWith({ dispatch })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/dispatch?board=proj',
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ spawned: 1, spawnedIds: ['t_1'] })
    expect(dispatch).toHaveBeenCalledWith('proj')
  })

  it('maps a REAL upstream failure to 502', async () => {
    app = await buildWith({
      dispatch: async () => {
        throw new DashboardError('boom', 502)
      },
    })
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/kanban/dispatch' })
    expect(res.statusCode).toBe(502)
  })
})

describe('POST /api/agent-deck/kanban/tasks/:id/terminate (orchestration)', () => {
  it('validates + proxies a terminate keyed on runId', async () => {
    const terminateRun = vi.fn(async () => ({ ok: true, taskId: 't_1', error: null }))
    app = await buildWith({ terminateRun })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/terminate?board=proj',
      payload: { runId: 42, reason: 'stuck' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, taskId: 't_1', error: null })
    expect(terminateRun).toHaveBeenCalledWith({ runId: 42, reason: 'stuck' }, 'proj')
  })

  it('rejects a missing/invalid runId with 400', async () => {
    const terminateRun = vi.fn(async () => ({ ok: true, taskId: 't_1', error: null }))
    app = await buildWith({ terminateRun })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/terminate',
      payload: { runId: 'not-a-number' },
    })
    expect(res.statusCode).toBe(400)
    expect(terminateRun).not.toHaveBeenCalled()
  })

  it('passes through an HONEST ok:false (run already ended) as a 200', async () => {
    const terminateRun = vi.fn(async () => ({
      ok: false,
      taskId: null,
      error: 'The run already ended.',
    }))
    app = await buildWith({ terminateRun })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/terminate',
      payload: { runId: 7 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: false })
  })
})

describe('POST /api/agent-deck/kanban/tasks/:id/reassign (orchestration)', () => {
  it('validates + proxies a reassign with reclaimFirst', async () => {
    const reassignTask = vi.fn(async () => ({ ok: true, assignee: 'smart', error: null }))
    app = await buildWith({ reassignTask })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/reassign?board=proj',
      payload: { profile: 'smart', reclaimFirst: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, assignee: 'smart', error: null })
    expect(reassignTask).toHaveBeenCalledWith(
      't_1',
      { profile: 'smart', reclaimFirst: true },
      'proj',
    )
  })

  it('accepts an empty body (unassign) and proxies it', async () => {
    const reassignTask = vi.fn(async () => ({ ok: true, assignee: null, error: null }))
    app = await buildWith({ reassignTask })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/reassign',
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(reassignTask).toHaveBeenCalledWith('t_1', {}, undefined)
  })

  it('rejects a non-string profile with 400', async () => {
    const reassignTask = vi.fn(async () => ({ ok: true, assignee: null, error: null }))
    app = await buildWith({ reassignTask })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/kanban/tasks/t_1/reassign',
      payload: { profile: 123 },
    })
    expect(res.statusCode).toBe(400)
    expect(reassignTask).not.toHaveBeenCalled()
  })
})
