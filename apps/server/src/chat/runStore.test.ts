import { describe, it, expect, vi, afterEach } from 'vitest'
import { RunStore } from './runStore'
import type { ChatServerEvent } from '@agent-deck/protocol'

function delta(d: string): ChatServerEvent {
  return { event: 'message.delta', run_id: 'r1', delta: d }
}

describe('RunStore', () => {
  it('assigns a monotonically incrementing cursor on append', () => {
    const store = new RunStore()
    const e1 = store.append('r1', delta('a'))
    const e2 = store.append('r1', delta('b'))
    expect(e1.cursor).toBe(1)
    expect(e2.cursor).toBe(2)
  })

  it('snapshot(after) returns only events strictly after the cursor', () => {
    const store = new RunStore()
    store.append('r1', delta('a')) // cursor 1
    store.append('r1', delta('b')) // cursor 2
    store.append('r1', delta('c')) // cursor 3

    expect(store.snapshot('r1', 0).map((e) => e.cursor)).toEqual([1, 2, 3])
    expect(store.snapshot('r1', 1).map((e) => e.cursor)).toEqual([2, 3])
    expect(store.snapshot('r1', 3)).toEqual([])
    expect(store.snapshot('unknown', 0)).toEqual([])
  })

  it('notifies subscribers with cursor-tagged events on append', () => {
    const store = new RunStore()
    const seen: number[] = []
    store.subscribe('r1', (e) => seen.push(e.cursor!))
    store.append('r1', delta('a'))
    store.append('r1', delta('b'))
    expect(seen).toEqual([1, 2])
  })

  it('stops notifying after unsubscribe', () => {
    const store = new RunStore()
    const seen: number[] = []
    const cb = (e: ChatServerEvent) => seen.push(e.cursor!)
    store.subscribe('r1', cb)
    store.append('r1', delta('a'))
    store.unsubscribe('r1', cb)
    store.append('r1', delta('b'))
    expect(seen).toEqual([1])
  })

  it('marks a run done on a terminal event and exposes isDone', () => {
    const store = new RunStore()
    expect(store.isDone('r1')).toBe(false)
    store.append('r1', delta('a'))
    expect(store.isDone('r1')).toBe(false)
    store.append('r1', { event: 'run.completed', run_id: 'r1', output: 'done' })
    expect(store.isDone('r1')).toBe(true)
  })

  describe('broadcast (transient frames)', () => {
    const heartbeat: ChatServerEvent = { event: 'run.heartbeat', run_id: 'r1' }

    it('notifies subscribers without assigning a cursor or buffering the event', () => {
      const store = new RunStore()
      const seen: ChatServerEvent[] = []
      store.append('r1', delta('a')) // cursor 1 — the run exists
      store.subscribe('r1', (e) => seen.push(e))
      store.broadcast('r1', heartbeat)
      expect(seen).toEqual([heartbeat])
      expect(seen[0]!.cursor).toBeUndefined()
      // The replay log is untouched: a resume never replays a heartbeat.
      expect(store.snapshot('r1', 0)).toHaveLength(1)
      // And the cursor sequence is not consumed by the broadcast.
      expect(store.append('r1', delta('b')).cursor).toBe(2)
    })

    it('is a no-op for an unknown run (never creates state)', () => {
      const store = new RunStore()
      expect(() => store.broadcast('ghost', heartbeat)).not.toThrow()
      expect(store.has('ghost')).toBe(false)
    })

    it('is a no-op for a terminal run (a finished run cannot heartbeat)', () => {
      const store = new RunStore()
      const seen: ChatServerEvent[] = []
      store.append('r1', { event: 'run.completed', run_id: 'r1', output: 'done' })
      store.subscribe('r1', (e) => seen.push(e))
      store.broadcast('r1', heartbeat)
      expect(seen).toEqual([])
    })

    it('counts as activity for the idle sweep (a heartbeating run is alive)', () => {
      vi.useFakeTimers()
      try {
        const store = new RunStore({ idleTtlMs: 1000, sweepIntervalMs: 100 })
        store.append('r1', delta('a'))
        // Keep heartbeating just inside the idle window: the run must survive.
        for (let i = 0; i < 5; i++) {
          vi.advanceTimersByTime(900)
          store.broadcast('r1', heartbeat)
        }
        expect(store.has('r1')).toBe(true)
        // Silence past the window: the non-terminal run is finally swept.
        vi.advanceTimersByTime(1200)
        expect(store.has('r1')).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('isolates events and cursors per run id', () => {
    const store = new RunStore()
    store.append('r1', delta('a'))
    const e = store.append('r2', { event: 'message.delta', run_id: 'r2', delta: 'x' })
    expect(e.cursor).toBe(1)
    expect(store.snapshot('r1', 0)).toHaveLength(1)
    expect(store.snapshot('r2', 0)).toHaveLength(1)
  })

  describe('eviction', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('evicts a terminal run after its TTL', () => {
      vi.useFakeTimers()
      const store = new RunStore({ terminalTtlMs: 1000 })
      store.append('r1', delta('a'))
      store.append('r1', { event: 'run.completed', run_id: 'r1', output: 'done' })

      // Just before the TTL, r1 is still retained.
      vi.advanceTimersByTime(999)
      expect(store.snapshot('r1', 0)).toHaveLength(2)

      // After the TTL, r1 is evicted.
      vi.advanceTimersByTime(2)
      expect(store.snapshot('r1', 0)).toEqual([])
      expect(store.isDone('r1')).toBe(false)
    })

    it('caps retained events per run at the configured bound', () => {
      const store = new RunStore({ maxEventsPerRun: 3 })
      for (let i = 0; i < 6; i++) store.append('r1', delta(String(i)))
      // Only the newest 3 are kept, cursors stay monotonic and truthful.
      const kept = store.snapshot('r1', 0)
      expect(kept.map((e) => e.cursor)).toEqual([4, 5, 6])
    })
  })

  describe('store-level bounds (defense in depth)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('sweeps a non-terminal run idle past the idle window', () => {
      vi.useFakeTimers()
      let now = 0
      const store = new RunStore({ idleTtlMs: 1000, sweepIntervalMs: 100, now: () => now })

      // r1 is appended once then goes quiet; r2 keeps getting activity.
      store.append('r1', delta('a'))
      store.append('r2', delta('b'))
      expect(store.snapshot('r1', 0)).toHaveLength(1)

      // r2 stays active right up to the edge; r1 does not.
      now = 900
      store.append('r2', delta('c'))

      // Advance a sweep tick past r1's idle window but within r2's.
      now = 1001
      vi.advanceTimersByTime(100)

      // r1 (idle past the window, never terminal) is evicted; r2 survives.
      expect(store.snapshot('r1', 0)).toEqual([])
      expect(store.snapshot('r2', 0)).toHaveLength(2)
    })

    it('sweeps an orphan run created by subscribe() alone (no append ever)', () => {
      vi.useFakeTimers()
      let now = 0
      const store = new RunStore({ idleTtlMs: 1000, sweepIntervalMs: 100, now: () => now })

      // subscribe() to an unknown runId calls ensure() — creating a non-terminal
      // run state that may NEVER see an append (a wedged/abandoned subscription).
      // The sweep must still be armed so this orphan is reaped, not leaked.
      const seen: number[] = []
      store.subscribe('orphan', (e) => seen.push(e.cursor!))

      // Advance a sweep tick past the idle window: the orphan should be evicted.
      now = 1001
      vi.advanceTimersByTime(100)

      // After eviction the run state (and its subscriber) is gone: a later append
      // creates a FRESH state with no subscribers, so the original callback never
      // fires. If the orphan had leaked (sweep never armed), the callback WOULD
      // fire here. The absence of a notification proves the orphan was reaped.
      store.append('orphan', delta('a'))
      expect(seen).toEqual([])
    })

    it('does not evict a non-terminal run still within the idle window', () => {
      vi.useFakeTimers()
      let now = 0
      const store = new RunStore({ idleTtlMs: 1000, sweepIntervalMs: 100, now: () => now })
      store.append('r1', delta('a'))

      now = 999
      vi.advanceTimersByTime(100)

      expect(store.snapshot('r1', 0)).toHaveLength(1)
    })

    it('evicts the oldest non-terminal run when the runs.size cap is exceeded', () => {
      const store = new RunStore({ maxRuns: 2 })
      store.append('r1', delta('a'))
      store.append('r2', delta('b'))
      // Third distinct run exceeds the cap: oldest non-terminal (r1) is evicted.
      store.append('r3', delta('c'))

      expect(store.snapshot('r1', 0)).toEqual([])
      expect(store.snapshot('r2', 0)).toHaveLength(1)
      expect(store.snapshot('r3', 0)).toHaveLength(1)
    })

    it('prefers evicting a non-terminal run over a terminal (still-TTL) one when over the cap', () => {
      const store = new RunStore({ maxRuns: 2, terminalTtlMs: 1_000_000 })
      // r1 finishes (terminal, retained for its TTL); r2 stays live.
      store.append('r1', delta('a'))
      store.append('r1', { event: 'run.completed', run_id: 'r1', output: 'done' })
      store.append('r2', delta('b'))
      // r3 exceeds the cap: the oldest NON-terminal (r2) is evicted, terminal r1 kept.
      store.append('r3', delta('c'))

      expect(store.snapshot('r1', 0)).toHaveLength(2)
      expect(store.snapshot('r2', 0)).toEqual([])
      expect(store.snapshot('r3', 0)).toHaveLength(1)
    })
  })
})
