import { describe, it, expect } from 'vitest'
import {
  KANBAN_COLUMNS,
  KANBAN_MOVE_TARGETS,
  KANBAN_NAMESPACE,
  KanbanBoard,
  KanbanBoardResponse,
  KanbanCard,
  KanbanCommentInput,
  KanbanCreateTaskInput,
  KanbanMoveTaskInput,
  KanbanSubscribeCommand,
  KanbanTask,
  KanbanWorkers,
  KanbanStats,
  KanbanBoardList,
  isMoveTarget,
  kanbanAvailability,
} from './kanban'
import { z } from 'zod'

const CARD = {
  id: 't_ab12',
  title: 'Ship the thing',
  column: 'running' as const,
  assignee: 'builder',
  priority: 5,
  latestSummary: 'working on it',
  createdAt: 1_700_000_000,
  startedAt: 1_700_000_100,
  completedAt: null,
  age: { createdAgeSeconds: 200, startedAgeSeconds: 100, timeToCompleteSeconds: null },
  worker: {
    id: 42,
    profile: 'builder',
    status: 'running',
    outcome: null,
    summary: null,
    startedAt: 1_700_000_100,
    endedAt: null,
  },
  commentCount: 2,
  linkCounts: { parents: 0, children: 3 },
  progress: { done: 1, total: 3 },
  warnings: { count: 1, highestSeverity: 'warning' },
}

describe('KANBAN_COLUMNS', () => {
  it('lists the eight columns in the fixed upstream order', () => {
    expect(KANBAN_COLUMNS).toEqual([
      'triage',
      'todo',
      'scheduled',
      'ready',
      'running',
      'blocked',
      'review',
      'done',
    ])
  })
})

describe('KanbanCard', () => {
  it('accepts a fully-populated running card', () => {
    expect(KanbanCard.parse(CARD)).toMatchObject({ id: 't_ab12', column: 'running' })
  })

  it('accepts a quiet card with no worker / progress / warnings', () => {
    const quiet = { ...CARD, column: 'todo' as const, worker: null, progress: null, warnings: null }
    expect(KanbanCard.parse(quiet).worker).toBeNull()
  })

  it('rejects an unknown column', () => {
    expect(KanbanCard.safeParse({ ...CARD, column: 'nope' }).success).toBe(false)
  })
})

describe('KanbanBoard', () => {
  it('parses a board with ordered columns + a cursor', () => {
    const board = KanbanBoard.parse({
      board: 'default',
      columns: KANBAN_COLUMNS.map((name) => ({ name, cards: [] })),
      assignees: ['builder'],
      cursor: 99,
      now: 1_700_000_300,
    })
    expect(board.columns.map((c) => c.name)).toEqual([...KANBAN_COLUMNS])
    expect(board.cursor).toBe(99)
  })
})

describe('KanbanTask / KanbanWorkers / KanbanStats / KanbanBoardList', () => {
  it('parses a task detail', () => {
    const task = KanbanTask.parse({
      card: CARD,
      body: 'do the thing',
      latestSummary: 'full summary text',
      comments: [{ id: 1, author: 'op', body: 'hi', createdAt: 1 }],
      events: [{ id: 1, kind: 'status', createdAt: 1 }],
      runs: [CARD.worker],
      links: { parents: ['t_parent'], children: ['t_child'] },
    })
    expect(task.links.children).toEqual(['t_child'])
  })

  it('parses active workers', () => {
    const w = KanbanWorkers.parse({
      workers: [
        {
          runId: 42,
          taskId: 't_ab12',
          taskTitle: 'Ship the thing',
          assignee: 'builder',
          profile: 'builder',
          startedAt: 1,
          lastHeartbeatAt: 2,
        },
      ],
      count: 1,
      checkedAt: 3,
    })
    expect(w.count).toBe(1)
  })

  it('parses stats', () => {
    const s = KanbanStats.parse({
      byStatus: { running: 1, done: 4 },
      byAssignee: { builder: { running: 1 } },
      oldestReadyAgeSeconds: null,
      now: 5,
    })
    expect(s.byStatus.done).toBe(4)
  })

  it('parses a board list', () => {
    const list = KanbanBoardList.parse({
      boards: [
        {
          slug: 'default',
          name: 'Default',
          description: '',
          icon: '',
          color: '',
          isCurrent: true,
          total: 5,
          counts: { running: 1 },
        },
      ],
      current: 'default',
    })
    expect(list.current).toBe('default')
  })
})

describe('kanbanAvailability — the portability contract', () => {
  it('parses the degraded { available: false } shape', () => {
    expect(KanbanBoardResponse.parse({ available: false })).toEqual({ available: false })
  })

  it('parses the { available: true, data } shape', () => {
    const wrapped = kanbanAvailability(z.object({ x: z.number() }))
    expect(wrapped.parse({ available: true, data: { x: 1 } })).toEqual({
      available: true,
      data: { x: 1 },
    })
  })

  it('rejects available:true without data', () => {
    expect(KanbanBoardResponse.safeParse({ available: true }).success).toBe(false)
  })
})

describe('namespace + subscribe command', () => {
  it('exposes the /kanban namespace path', () => {
    expect(KANBAN_NAMESPACE).toBe('/kanban')
  })

  it('accepts an empty subscribe (active board) and an explicit board', () => {
    expect(KanbanSubscribeCommand.parse({})).toEqual({})
    expect(KanbanSubscribeCommand.parse({ board: 'proj' }).board).toBe('proj')
  })
})

describe('mutation move targets — the honesty constraint', () => {
  it('is the backend-accepted subset of the columns (no running/review/archived)', () => {
    expect([...KANBAN_MOVE_TARGETS]).toEqual([
      'triage',
      'todo',
      'scheduled',
      'ready',
      'blocked',
      'done',
    ])
    expect(KANBAN_MOVE_TARGETS).not.toContain('running')
    expect(KANBAN_MOVE_TARGETS).not.toContain('review')
    expect(KANBAN_MOVE_TARGETS).not.toContain('archived')
  })

  it('isMoveTarget narrows to the writable columns only', () => {
    expect(isMoveTarget('todo')).toBe(true)
    expect(isMoveTarget('done')).toBe(true)
    expect(isMoveTarget('running')).toBe(false)
    expect(isMoveTarget('review')).toBe(false)
    expect(isMoveTarget('archived')).toBe(false)
  })

  it('KanbanMoveTaskInput accepts a real target and rejects running/review', () => {
    expect(KanbanMoveTaskInput.parse({ status: 'ready' }).status).toBe('ready')
    expect(KanbanMoveTaskInput.safeParse({ status: 'running' }).success).toBe(false)
    expect(KanbanMoveTaskInput.safeParse({ status: 'review' }).success).toBe(false)
  })
})

describe('create-task + comment inputs', () => {
  it('requires a non-empty trimmed title', () => {
    expect(KanbanCreateTaskInput.parse({ title: '  Build it  ' }).title).toBe('Build it')
    expect(KanbanCreateTaskInput.safeParse({ title: '   ' }).success).toBe(false)
    expect(KanbanCreateTaskInput.safeParse({}).success).toBe(false)
  })

  it('carries optional body / assignee / priority', () => {
    const parsed = KanbanCreateTaskInput.parse({
      title: 'T',
      body: 'desc',
      assignee: 'builder',
      priority: 5,
    })
    expect(parsed).toEqual({ title: 'T', body: 'desc', assignee: 'builder', priority: 5 })
  })

  it('requires a non-empty trimmed comment body', () => {
    expect(KanbanCommentInput.parse({ body: ' hi ' }).body).toBe('hi')
    expect(KanbanCommentInput.safeParse({ body: '   ' }).success).toBe(false)
  })
})
