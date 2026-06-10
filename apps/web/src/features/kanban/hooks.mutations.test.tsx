import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KanbanBoardResponse } from '@agent-deck/protocol'
import {
  kanbanKeys,
  useCreateTask,
  useMoveTask,
  useAddComment,
  useDispatch,
  useRunTask,
  useTerminateRun,
  useReassignTask,
} from './hooks'
import { availableBoard, makeCard } from './testFixtures'

// Mock the API client so the hooks exercise their optimistic/rollback logic
// without touching the network.
vi.mock('./kanbanApi', () => ({
  createTask: vi.fn(),
  moveTask: vi.fn(),
  addComment: vi.fn(),
  fetchBoard: vi.fn(),
  fetchBoards: vi.fn(),
  fetchTask: vi.fn(),
  dispatch: vi.fn(),
  terminateRun: vi.fn(),
  reassignTask: vi.fn(),
}))

import { createTask, moveTask, addComment, dispatch, terminateRun, reassignTask } from './kanbanApi'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

function columnOf(board: KanbanBoardResponse | undefined, id: string): string | undefined {
  if (!board || board.available === false) return undefined
  for (const col of board.data.columns) {
    if (col.cards.some((c) => c.id === id)) return col.name
  }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useMoveTask — optimistic move with honest rollback', () => {
  it('moves the card optimistically and keeps it there on success', async () => {
    const qc = makeClient()
    qc.setQueryData<KanbanBoardResponse>(
      kanbanKeys.board(undefined),
      availableBoard({ todo: [makeCard({ id: 't_1', column: 'todo' })] }),
    )
    vi.mocked(moveTask).mockResolvedValue({ ok: true, error: null })

    const { result } = renderHook(() => useMoveTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1', status: 'ready' })

    // Optimistically relocated immediately.
    await waitFor(() =>
      expect(columnOf(qc.getQueryData(kanbanKeys.board(undefined)), 't_1')).toBe('ready'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(columnOf(qc.getQueryData(kanbanKeys.board(undefined)), 't_1')).toBe('ready')
    expect(moveTask).toHaveBeenCalledWith('t_1', 'ready', undefined)
  })

  it('ROLLS BACK to the prior column when the backend REFUSES (ok:false) — no fake success', async () => {
    const qc = makeClient()
    qc.setQueryData<KanbanBoardResponse>(
      kanbanKeys.board(undefined),
      availableBoard({ todo: [makeCard({ id: 't_1', column: 'todo' })] }),
    )
    vi.mocked(moveTask).mockResolvedValue({
      ok: false,
      error: "transition to 'ready' refused",
    })

    const { result } = renderHook(() => useMoveTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1', status: 'ready' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // Restored to the original column, and the real reason is on the error.
    expect(columnOf(qc.getQueryData(kanbanKeys.board(undefined)), 't_1')).toBe('todo')
    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toBe("transition to 'ready' refused")
  })

  it('rolls back when the request throws (network failure)', async () => {
    const qc = makeClient()
    qc.setQueryData<KanbanBoardResponse>(
      kanbanKeys.board(undefined),
      availableBoard({ todo: [makeCard({ id: 't_1', column: 'todo' })] }),
    )
    vi.mocked(moveTask).mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useMoveTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1', status: 'done' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(columnOf(qc.getQueryData(kanbanKeys.board(undefined)), 't_1')).toBe('todo')
  })
})

describe('useCreateTask', () => {
  it('creates and invalidates the board query on success', async () => {
    const qc = makeClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.mocked(createTask).mockResolvedValue({ id: 't_new' })

    const { result } = renderHook(() => useCreateTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ title: 'New one' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(createTask).toHaveBeenCalledWith({ title: 'New one' }, undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.board(undefined) })
  })
})

describe('useAddComment', () => {
  it('posts and invalidates both the task detail and the board on success', async () => {
    const qc = makeClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.mocked(addComment).mockResolvedValue({ ok: true })

    const { result } = renderHook(() => useAddComment(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1', input: { body: 'nice' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(addComment).toHaveBeenCalledWith('t_1', { body: 'nice' }, undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.task('t_1', undefined) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.board(undefined) })
  })
})

describe('useDispatch', () => {
  it('nudges the dispatcher and invalidates the board on success', async () => {
    const qc = makeClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.mocked(dispatch).mockResolvedValue({
      spawned: 1,
      spawnedIds: ['t_1'],
      promoted: 0,
      reclaimed: 0,
      skippedUnassigned: [],
    })

    const { result } = renderHook(() => useDispatch(undefined), { wrapper: wrapper(qc) })
    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(dispatch).toHaveBeenCalledWith(undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.board(undefined) })
  })
})

describe('useRunTask — the HONEST two-step (move-to-ready then dispatch)', () => {
  it('moves to ready then dispatches, resolving to the dispatch tally', async () => {
    const qc = makeClient()
    vi.mocked(moveTask).mockResolvedValue({ ok: true, error: null })
    vi.mocked(dispatch).mockResolvedValue({
      spawned: 1,
      spawnedIds: ['t_1'],
      promoted: 0,
      reclaimed: 0,
      skippedUnassigned: [],
    })

    const { result } = renderHook(() => useRunTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(moveTask).toHaveBeenCalledWith('t_1', 'ready', undefined)
    expect(dispatch).toHaveBeenCalledWith(undefined)
    expect(result.current.data?.spawnedIds).toEqual(['t_1'])
  })

  it('does NOT dispatch when the move-to-ready is refused (no fake run)', async () => {
    const qc = makeClient()
    vi.mocked(moveTask).mockResolvedValue({ ok: false, error: 'parents not done' })

    const { result } = renderHook(() => useRunTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('parents not done')
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('useTerminateRun', () => {
  it('terminates and invalidates the task + board; an ok:false is NOT an error', async () => {
    const qc = makeClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.mocked(terminateRun).mockResolvedValue({ ok: false, taskId: null, error: 'already ended' })

    const { result } = renderHook(() => useTerminateRun(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1', input: { runId: 42 } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(terminateRun).toHaveBeenCalledWith('t_1', { runId: 42 }, undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.task('t_1', undefined) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.board(undefined) })
  })
})

describe('useReassignTask', () => {
  it('reassigns and invalidates on success', async () => {
    const qc = makeClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.mocked(reassignTask).mockResolvedValue({ ok: true, assignee: 'smart', error: null })

    const { result } = renderHook(() => useReassignTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1', input: { profile: 'smart', reclaimFirst: true } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(reassignTask).toHaveBeenCalledWith(
      't_1',
      { profile: 'smart', reclaimFirst: true },
      undefined,
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.task('t_1', undefined) })
  })

  it('surfaces an ok:false refusal as an error (so the UI can re-offer with reclaim)', async () => {
    const qc = makeClient()
    vi.mocked(reassignTask).mockResolvedValue({
      ok: false,
      assignee: null,
      error: 'still running',
    })

    const { result } = renderHook(() => useReassignTask(undefined), { wrapper: wrapper(qc) })
    result.current.mutate({ id: 't_1', input: { profile: 'x' } })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('still running')
  })
})
