/**
 * Shared test fixtures for the Kanban surface — a board snapshot factory so each
 * test states only the fields it cares about. Not shipped (imported only by
 * `*.test.tsx`); kept out of the barrel.
 */
import {
  KANBAN_COLUMNS,
  type KanbanBoard,
  type KanbanBoardResponse,
  type KanbanCard,
  type KanbanColumn,
} from '@agent-deck/protocol'

export function makeCard(over: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 't_abc',
    title: 'A task',
    column: 'todo',
    assignee: 'coder',
    priority: 0,
    latestSummary: null,
    createdAt: 1_700_000_000,
    startedAt: null,
    completedAt: null,
    age: { createdAgeSeconds: 600, startedAgeSeconds: null, timeToCompleteSeconds: null },
    worker: null,
    commentCount: 0,
    linkCounts: { parents: 0, children: 0 },
    progress: null,
    warnings: null,
    ...over,
  }
}

/** Build the 8 ordered columns, seeding cards by column name. */
export function makeBoard(
  cardsByColumn: Partial<Record<KanbanColumn['name'], KanbanCard[]>> = {},
  over: Partial<KanbanBoard> = {},
): KanbanBoard {
  const columns: KanbanColumn[] = KANBAN_COLUMNS.map((name) => ({
    name,
    cards: cardsByColumn[name] ?? [],
  }))
  return {
    board: 'main',
    columns,
    assignees: ['coder'],
    cursor: 1,
    now: 1_700_000_600,
    ...over,
  }
}

export function availableBoard(
  cardsByColumn?: Partial<Record<KanbanColumn['name'], KanbanCard[]>>,
  over?: Partial<KanbanBoard>,
): KanbanBoardResponse {
  return { available: true, data: makeBoard(cardsByColumn, over) }
}
