/**
 * RunControls — the orchestration panel (Run / Stop / Reassign). Verifies the
 * HONEST gating (which control shows for which column + run state) and that each
 * fires the right real-route-backed write. The API client is mocked so the panel
 * exercises its own gating + the hooks' wiring without the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KanbanCard, KanbanTask } from '@agent-deck/protocol'
import { RunControls } from './RunControls'
import { makeCard } from './testFixtures'

vi.mock('./kanbanApi', () => ({
  moveTask: vi.fn(),
  dispatch: vi.fn(),
  terminateRun: vi.fn(),
  reassignTask: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { moveTask, dispatch, terminateRun, reassignTask } from './kanbanApi'

function wrap(card: KanbanCard, props: { task?: KanbanTask; assignees?: string[] } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const ui = createElement(
    QueryClientProvider,
    { client: qc },
    createElement(RunControls, {
      card,
      task: props.task,
      board: 'proj',
      assignees: props.assignees,
    }),
  ) as ReactNode
  return render(ui)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RunControls — honest gating', () => {
  it('shows Run (not Stop) for a todo card and runs the two-step', async () => {
    vi.mocked(moveTask).mockResolvedValue({ ok: true, error: null })
    vi.mocked(dispatch).mockResolvedValue({
      spawned: 1,
      spawnedIds: ['t_1'],
      promoted: 0,
      reclaimed: 0,
      skippedUnassigned: [],
    })
    wrap(makeCard({ id: 't_1', column: 'todo' }))

    expect(screen.getByTestId('kanban-run-button')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-stop-button')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('kanban-run-button'))
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith('t_1', 'ready', 'proj'))
    expect(dispatch).toHaveBeenCalledWith('proj')
  })

  it('shows Stop (not Run) for a running card with a live run id and terminates it', async () => {
    vi.mocked(terminateRun).mockResolvedValue({ ok: true, taskId: 't_1', error: null })
    wrap(
      makeCard({
        id: 't_1',
        column: 'running',
        worker: {
          id: 77,
          profile: 'builder',
          status: 'running',
          outcome: null,
          summary: null,
          startedAt: 1,
          endedAt: null,
        },
      }),
    )

    expect(screen.queryByTestId('kanban-run-button')).not.toBeInTheDocument()
    const stop = screen.getByTestId('kanban-stop-button')
    await userEvent.click(stop)
    await waitFor(() => expect(terminateRun).toHaveBeenCalledWith('t_1', { runId: 77 }, 'proj'))
  })

  it('omits Run + Stop for a done card (terminal -- renders nothing)', () => {
    const { container } = wrap(makeCard({ column: 'done' }))
    expect(container.querySelector('[data-testid="kanban-run-controls"]')).toBeNull()
  })

  it('reassigns with reclaimFirst when the task is running', async () => {
    vi.mocked(reassignTask).mockResolvedValue({ ok: true, assignee: 'smart', error: null })
    wrap(
      makeCard({
        id: 't_1',
        column: 'running',
        assignee: 'builder',
        worker: {
          id: 5,
          profile: 'builder',
          status: 'running',
          outcome: null,
          summary: null,
          startedAt: 1,
          endedAt: null,
        },
      }),
      { assignees: ['builder', 'smart'] },
    )

    await userEvent.click(screen.getByTestId('kanban-reassign-toggle'))
    // The board's other assignee shows as a quick chip.
    await userEvent.click(screen.getByRole('button', { name: 'smart' }))
    await waitFor(() =>
      expect(reassignTask).toHaveBeenCalledWith(
        't_1',
        { profile: 'smart', reclaimFirst: true },
        'proj',
      ),
    )
  })

  it('reassigns WITHOUT reclaimFirst when the task is not running', async () => {
    vi.mocked(reassignTask).mockResolvedValue({ ok: true, assignee: 'smart', error: null })
    wrap(makeCard({ id: 't_1', column: 'todo', assignee: 'builder' }), {
      assignees: ['builder', 'smart'],
    })

    await userEvent.click(screen.getByTestId('kanban-reassign-toggle'))
    await userEvent.click(screen.getByRole('button', { name: 'smart' }))
    await waitFor(() =>
      expect(reassignTask).toHaveBeenCalledWith(
        't_1',
        { profile: 'smart', reclaimFirst: false },
        'proj',
      ),
    )
  })
})
