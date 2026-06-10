import { describe, it, expect } from 'vitest'
import type { KanbanBoardResponse, KanbanCard, KanbanColumnName } from '@agent-deck/protocol'
import { KANBAN_COLUMNS } from '@agent-deck/protocol'
import { applyOptimisticMove } from './optimisticMove'

function card(id: string, column: KanbanColumnName): KanbanCard {
  return {
    id,
    title: id,
    column,
    assignee: null,
    priority: 0,
    latestSummary: null,
    createdAt: null,
    startedAt: null,
    completedAt: null,
    age: null,
    worker: null,
    commentCount: 0,
    linkCounts: { parents: 0, children: 0 },
    progress: null,
    warnings: null,
  }
}

function board(cards: KanbanCard[]): KanbanBoardResponse {
  return {
    available: true,
    data: {
      board: 'default',
      columns: KANBAN_COLUMNS.map((name) => ({
        name,
        cards: cards.filter((c) => c.column === name),
      })),
      assignees: [],
      cursor: 1,
      now: 1,
    },
  }
}

function cardsIn(b: KanbanBoardResponse, column: KanbanColumnName): string[] {
  if (b.available === false) return []
  return b.data.columns.find((c) => c.name === column)?.cards.map((c) => c.id) ?? []
}

describe('applyOptimisticMove', () => {
  it('moves the card out of its source column into the target, updating its column field', () => {
    const before = board([card('t_1', 'todo'), card('t_2', 'todo')])
    const after = applyOptimisticMove(before, 't_1', 'ready')

    expect(cardsIn(after, 'todo')).toEqual(['t_2'])
    expect(cardsIn(after, 'ready')).toEqual(['t_1'])
    if (after.available) {
      const moved = after.data.columns
        .find((c) => c.name === 'ready')!
        .cards.find((c) => c.id === 't_1')!
      expect(moved.column).toBe('ready')
    }
  })

  it('is a no-op when the card is already in the target column', () => {
    const before = board([card('t_1', 'ready')])
    const after = applyOptimisticMove(before, 't_1', 'ready')
    expect(cardsIn(after, 'ready')).toEqual(['t_1'])
  })

  it('does not mutate the original board (returns a fresh snapshot)', () => {
    const before = board([card('t_1', 'todo')])
    const after = applyOptimisticMove(before, 't_1', 'done')
    expect(after).not.toBe(before)
    // original untouched
    expect(cardsIn(before, 'todo')).toEqual(['t_1'])
    expect(cardsIn(before, 'done')).toEqual([])
  })

  it('returns the snapshot unchanged when the id is not on the board', () => {
    const before = board([card('t_1', 'todo')])
    const after = applyOptimisticMove(before, 't_missing', 'done')
    expect(cardsIn(after, 'todo')).toEqual(['t_1'])
    expect(cardsIn(after, 'done')).toEqual([])
  })

  it('passes through an unavailable board untouched', () => {
    const unavailable: KanbanBoardResponse = { available: false }
    expect(applyOptimisticMove(unavailable, 't_1', 'done')).toEqual({ available: false })
  })
})
