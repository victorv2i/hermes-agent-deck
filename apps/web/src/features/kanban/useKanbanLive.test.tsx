import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useKanbanLive } from './useKanbanLive'
import { kanbanKeys } from './hooks'
import type { KanbanSocketLike } from './kanbanSocket'
import { availableBoard, makeCard } from './testFixtures'

/** A fake socket.io transport the hook drives; the test fires server events. */
class FakeSocket implements KanbanSocketLike {
  connected = false
  private handlers = new Map<string, ((...a: unknown[]) => void)[]>()
  on(event: string, listener: (...a: unknown[]) => void) {
    const list = this.handlers.get(event) ?? []
    list.push(listener)
    this.handlers.set(event, list)
    return this
  }
  off() {
    return this
  }
  emit() {
    return this
  }
  connect() {
    this.connected = true
    this.fire('connect')
    return this
  }
  disconnect() {
    this.connected = false
    return this
  }
  fire(event: string, ...args: unknown[]) {
    for (const l of this.handlers.get(event) ?? []) l(...args)
  }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const fake = new FakeSocket()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, fake, wrapper }
}

describe('useKanbanLive', () => {
  it('writes an inbound snapshot straight into the board query cache', () => {
    const { client, fake, wrapper } = setup()
    renderHook(() => useKanbanLive('main', { socket: fake }), { wrapper })

    const snapshot = availableBoard({ running: [makeCard({ id: 't_live', column: 'running' })] })
    act(() => fake.fire('kanban.snapshot', snapshot))

    expect(client.getQueryData(kanbanKeys.board('main'))).toEqual(snapshot)
  })

  it('reports the live connection status', () => {
    const { fake, wrapper } = setup()
    const { result } = renderHook(() => useKanbanLive(undefined, { socket: fake }), { wrapper })
    // connect() fires synchronously on mount → connected.
    expect(result.current).toBe('connected')
  })

  it('invalidates the open task on each snapshot so the drawer stays live', () => {
    const { client, fake, wrapper } = setup()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderHook(() => useKanbanLive('main', { socket: fake, openTaskId: 't_open' }), { wrapper })

    act(() => fake.fire('kanban.snapshot', availableBoard()))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: kanbanKeys.task('t_open', 'main') })
  })

  it('does not invalidate a task when none is open', () => {
    const { client, fake, wrapper } = setup()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderHook(() => useKanbanLive('main', { socket: fake, openTaskId: null }), { wrapper })

    act(() => fake.fire('kanban.snapshot', availableBoard()))

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does NOT clobber the board cache while a board move/run mutation is in flight', () => {
    const { client, fake, wrapper } = setup()
    // Seed the cache with the optimistic state a move just produced.
    const optimistic = availableBoard({ running: [makeCard({ id: 't_x', column: 'running' })] })
    client.setQueryData(kanbanKeys.board('main'), optimistic)
    // Pretend a board move/run mutation is in flight (the snapshot must NOT win).
    const isMutating = vi.spyOn(client, 'isMutating').mockReturnValue(1)

    renderHook(() => useKanbanLive('main', { socket: fake }), { wrapper })

    // A stale upstream snapshot still shows the card in `todo` — writing it would
    // snap the card back, clobbering the in-flight optimistic move.
    const stale = availableBoard({ todo: [makeCard({ id: 't_x', column: 'todo' })] })
    act(() => fake.fire('kanban.snapshot', stale))

    expect(isMutating).toHaveBeenCalled()
    // The optimistic state is preserved — the snapshot was held.
    expect(client.getQueryData(kanbanKeys.board('main'))).toEqual(optimistic)
  })

  it('writes the snapshot once no board mutation is in flight', () => {
    const { client, fake, wrapper } = setup()
    client.setQueryData(kanbanKeys.board('main'), availableBoard())
    // No mutation in flight → the snapshot writes through as normal.
    vi.spyOn(client, 'isMutating').mockReturnValue(0)

    renderHook(() => useKanbanLive('main', { socket: fake }), { wrapper })

    const fresh = availableBoard({ running: [makeCard({ id: 't_y', column: 'running' })] })
    act(() => fake.fire('kanban.snapshot', fresh))

    expect(client.getQueryData(kanbanKeys.board('main'))).toEqual(fresh)
  })
})
