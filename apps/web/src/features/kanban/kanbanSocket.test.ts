import { describe, it, expect, vi } from 'vitest'
import { KanbanSocket, type KanbanSocketLike } from './kanbanSocket'
import { availableBoard, makeCard } from './testFixtures'

/** A fake socket.io transport: records emits, lets the test fire server events. */
class FakeSocket implements KanbanSocketLike {
  connected = false
  emits: { event: string; args: unknown[] }[] = []
  private handlers = new Map<string, ((...a: unknown[]) => void)[]>()
  connectCalls = 0
  disconnectCalls = 0

  on(event: string, listener: (...a: unknown[]) => void) {
    const list = this.handlers.get(event) ?? []
    list.push(listener)
    this.handlers.set(event, list)
    return this
  }
  off() {
    return this
  }
  emit(event: string, ...args: unknown[]) {
    this.emits.push({ event, args })
    return this
  }
  connect() {
    this.connectCalls++
    this.connected = true
    this.fire('connect')
    return this
  }
  disconnect() {
    this.disconnectCalls++
    this.connected = false
    return this
  }
  fire(event: string, ...args: unknown[]) {
    for (const l of this.handlers.get(event) ?? []) l(...args)
  }
  emitsFor(event: string) {
    return this.emits.filter((e) => e.event === event)
  }
}

describe('KanbanSocket', () => {
  it('subscribes the named board once connected', () => {
    const fake = new FakeSocket()
    const k = new KanbanSocket({ onSnapshot: vi.fn() }, { socket: fake })
    k.subscribe('my-board')
    expect(fake.emitsFor('kanban.subscribe')).toHaveLength(0) // buffered until connect
    k.connect()
    const subs = fake.emitsFor('kanban.subscribe')
    expect(subs).toHaveLength(1)
    expect(subs[0]!.args[0]).toEqual({ board: 'my-board' })
  })

  it('subscribes the active board (empty payload) when no slug is given', () => {
    const fake = new FakeSocket()
    const k = new KanbanSocket({ onSnapshot: vi.fn() }, { socket: fake })
    k.connect()
    k.subscribe(undefined)
    expect(fake.emitsFor('kanban.subscribe')[0]!.args[0]).toEqual({})
  })

  it('validates and forwards a kanban.snapshot to onSnapshot', () => {
    const fake = new FakeSocket()
    const onSnapshot = vi.fn()
    const k = new KanbanSocket({ onSnapshot }, { socket: fake })
    k.connect()
    k.subscribe('b')
    const snapshot = availableBoard({ todo: [makeCard()] })
    fake.fire('kanban.snapshot', snapshot)
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot.mock.calls[0]![0]).toEqual(snapshot)
  })

  it('drops a malformed snapshot frame (never forwards garbage)', () => {
    const fake = new FakeSocket()
    const onSnapshot = vi.fn()
    const k = new KanbanSocket({ onSnapshot }, { socket: fake })
    k.connect()
    fake.fire('kanban.snapshot', { available: true, data: { not: 'a board' } })
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('surfaces a kanban.error message calmly', () => {
    const fake = new FakeSocket()
    const onError = vi.fn()
    const k = new KanbanSocket({ onSnapshot: vi.fn(), onError }, { socket: fake })
    k.connect()
    fake.fire('kanban.error', { message: 'upstream hiccup' })
    expect(onError).toHaveBeenCalledWith({ message: 'upstream hiccup' })
  })

  it('re-subscribes the current board on reconnect', () => {
    const fake = new FakeSocket()
    const k = new KanbanSocket({ onSnapshot: vi.fn() }, { socket: fake })
    k.connect()
    k.subscribe('b')
    expect(fake.emitsFor('kanban.subscribe')).toHaveLength(1)
    // Simulate a drop + reconnect.
    fake.fire('disconnect')
    fake.fire('connect')
    expect(fake.emitsFor('kanban.subscribe')).toHaveLength(2)
    expect(fake.emitsFor('kanban.subscribe')[1]!.args[0]).toEqual({ board: 'b' })
  })

  it('reports status transitions', () => {
    const fake = new FakeSocket()
    const onStatusChange = vi.fn()
    const k = new KanbanSocket({ onSnapshot: vi.fn(), onStatusChange }, { socket: fake })
    k.connect()
    expect(onStatusChange).toHaveBeenCalledWith('connecting')
    expect(onStatusChange).toHaveBeenCalledWith('connected')
    fake.fire('disconnect')
    expect(onStatusChange).toHaveBeenCalledWith('disconnected')
  })

  it('does not emit after dispose', () => {
    const fake = new FakeSocket()
    const k = new KanbanSocket({ onSnapshot: vi.fn() }, { socket: fake })
    k.connect()
    k.dispose()
    expect(fake.disconnectCalls).toBe(1)
    k.subscribe('late')
    expect(fake.emitsFor('kanban.subscribe')).toHaveLength(0)
  })
})
