import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ChatServerEvent } from '@agent-deck/protocol'
import { RunManager, mapGatewayEvent } from './runManager'
import { RunStore } from './runStore'
import type { GatewayClientLike, GatewayEvent, StartRunArgs } from '../hermes/gatewayClient'

/**
 * A fully scriptable gateway stub for the pump/reaper tests. Unlike the canned
 * MockGatewayClient, each run's stream is driven by hand: tests push frames,
 * fire heartbeats, or leave it silent to exercise the idle reaper.
 */
class ScriptedGateway implements GatewayClientLike {
  private readonly streams = new Map<string, ScriptedStream>()

  startRun(_args: StartRunArgs): Promise<{ runId: string }> {
    void _args
    return Promise.resolve({ runId: 'unused' })
  }

  getRunSession(_runId: string): Promise<{ sessionId: string | null }> {
    void _runId
    return Promise.resolve({ sessionId: null })
  }

  /** Get (creating) the control handle for a run's stream. */
  stream(runId: string): ScriptedStream {
    let s = this.streams.get(runId)
    if (!s) {
      s = new ScriptedStream()
      this.streams.set(runId, s)
    }
    return s
  }

  async *streamRun(
    runId: string,
    signal?: AbortSignal,
    onHeartbeat?: () => void,
  ): AsyncGenerator<GatewayEvent, void, unknown> {
    const s = this.stream(runId)
    yield* s.iterate(signal, onHeartbeat)
  }

  respondApproval(): Promise<void> {
    return Promise.resolve()
  }

  stopRun(_runId: string): Promise<void> {
    void _runId
    return Promise.resolve()
  }
}

/** A hand-driven async stream: tests `push()` frames, `heartbeat()`, or `end()`. */
class ScriptedStream {
  private queue: GatewayEvent[] = []
  private done = false
  private wake: (() => void) | null = null
  private onHeartbeat?: () => void

  push(event: GatewayEvent): void {
    this.queue.push(event)
    // Mirror the real gateway: the SSE closes right after a terminal frame.
    if (
      event.event === 'run.completed' ||
      event.event === 'run.failed' ||
      event.event === 'run.cancelled'
    ) {
      this.done = true
    }
    this.wake?.()
  }

  heartbeat(): void {
    this.onHeartbeat?.()
  }

  end(): void {
    this.done = true
    this.wake?.()
  }

  async *iterate(
    signal?: AbortSignal,
    onHeartbeat?: () => void,
  ): AsyncGenerator<GatewayEvent, void, unknown> {
    this.onHeartbeat = onHeartbeat
    while (true) {
      if (signal?.aborted) return
      if (this.queue.length > 0) {
        yield this.queue.shift()!
        continue
      }
      if (this.done) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      this.wake = null
    }
  }
}

/** A controllable clock so liveness decisions are deterministic and independent
 * of wall time / fake-timer Date mocking. */
function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

/** Drain pending microtasks AND a macrotask turn so the fire-and-forget pump's
 * generator fully settles (yield → resume → return → finally). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RunManager idle reaper', () => {
  it('synthesizes run.failed for a pump that sees no activity within the idle window', async () => {
    vi.useFakeTimers()
    const c = clock()
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store, {
      idleTimeoutMs: 1000,
      reaperIntervalMs: 100,
      now: c.now,
    })

    manager.start('r1')
    // First frame lands (resets the clock to t=0), then the stream goes silent.
    gateway.stream('r1').push({ event: 'message.delta', run_id: 'r1', delta: 'a' })
    await vi.advanceTimersByTimeAsync(0) // flush the pump's frame consumption
    expect(store.isDone('r1')).toBe(false)

    // Advance the injected clock just under the window, then sweep: still alive.
    c.advance(999)
    await vi.advanceTimersByTimeAsync(100)
    expect(store.isDone('r1')).toBe(false)

    // Cross the window — the next sweep declares it wedged.
    c.advance(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(store.isDone('r1')).toBe(true)
    const terminal = store.snapshot('r1', 0).at(-1)
    expect(terminal?.event).toBe('run.failed')
    expect(manager.isActive('r1')).toBe(false)
  })

  it('does NOT reap a long-thinking run whose stream emits only keepalives', async () => {
    vi.useFakeTimers()
    const c = clock()
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store, {
      idleTimeoutMs: 1000,
      reaperIntervalMs: 100,
      now: c.now,
    })

    manager.start('r1') // interval is now a FAKE timer, so sweeps really run below
    gateway.stream('r1').push({ event: 'message.delta', run_id: 'r1', delta: 'thinking' })
    await vi.advanceTimersByTimeAsync(0)

    // Keepalives arrive every 500ms (well within the window) for a span far
    // longer than the idle timeout — a legitimately long-thinking agent.
    for (let i = 0; i < 10; i++) {
      c.advance(500)
      gateway.stream('r1').heartbeat() // resets lastActivityAt to the current clock
      await vi.advanceTimersByTimeAsync(500) // sweeps fire (interval 100ms) but find it alive
    }

    expect(store.isDone('r1')).toBe(false)
    expect(manager.isActive('r1')).toBe(true)
  })

  it('forwards each gateway keepalive to subscribers as a transient run.heartbeat', async () => {
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store)

    const seen: ChatServerEvent[] = []
    store.subscribe('r1', (e) => seen.push(e))

    manager.start('r1', 'sess-1')
    gateway.stream('r1').push({ event: 'message.delta', run_id: 'r1', delta: 'a' })
    await settle()

    gateway.stream('r1').heartbeat()
    gateway.stream('r1').heartbeat()

    const heartbeats = seen.filter((e) => e.event === 'run.heartbeat')
    expect(heartbeats).toHaveLength(2)
    // Transient: no cursor (never buffered), carries the run + known session id.
    expect(heartbeats[0]).toEqual({ event: 'run.heartbeat', run_id: 'r1', session_id: 'sess-1' })
    expect(heartbeats[0]!.cursor).toBeUndefined()
    // The replay log holds only the real frame — a resume never replays liveness.
    expect(store.snapshot('r1', 0).map((e) => e.event)).toEqual(['message.delta'])

    gateway.stream('r1').push({ event: 'run.completed', run_id: 'r1', output: 'done' })
    await settle()
  })

  it('a gateway DATA frame named run.heartbeat is broadcast-only, never cursored into the replay log', async () => {
    // Heartbeats are synthesized by the BFF from SSE keepalives; the gateway
    // should never send one as a data frame. If it ever did, the frame parses
    // cleanly as protocol, so without an explicit pump guard it would be
    // appended (cursored) and replayed on resume. Pin the invariant instead:
    // broadcast to live subscribers only, exactly like the synthesized path.
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store)

    const seen: ChatServerEvent[] = []
    store.subscribe('r1', (e) => seen.push(e))

    manager.start('r1', 'sess-1')
    gateway.stream('r1').push({ event: 'message.delta', run_id: 'r1', delta: 'a' })
    gateway.stream('r1').push({ event: 'run.heartbeat', run_id: 'r1' })
    await settle()

    // Broadcast reached the live subscriber, without a cursor.
    const heartbeats = seen.filter((e) => e.event === 'run.heartbeat')
    expect(heartbeats).toHaveLength(1)
    expect(heartbeats[0]!.cursor).toBeUndefined()
    // The replay log never buffers a heartbeat, whatever its source.
    expect(store.snapshot('r1', 0).map((e) => e.event)).toEqual(['message.delta'])

    gateway.stream('r1').push({ event: 'run.completed', run_id: 'r1', output: 'done' })
    await settle()
  })

  it('keeps a chatty run alive: each new frame resets the idle clock', async () => {
    vi.useFakeTimers()
    const c = clock()
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store, {
      idleTimeoutMs: 1000,
      reaperIntervalMs: 100,
      now: c.now,
    })

    manager.start('r1')
    for (let i = 0; i < 5; i++) {
      c.advance(700) // < window, but only because frames keep coming
      gateway.stream('r1').push({ event: 'message.delta', run_id: 'r1', delta: String(i) })
      await vi.advanceTimersByTimeAsync(100) // a sweep fires, but the new frame kept it alive
    }
    expect(store.isDone('r1')).toBe(false)
    expect(manager.isActive('r1')).toBe(true)
  })

  it('stops the reaper interval once no pumps remain (no leaked timer)', async () => {
    const c = clock()
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store, {
      idleTimeoutMs: 1000,
      reaperIntervalMs: 100,
      now: c.now,
    })

    manager.start('r1')
    expect(setSpy).toHaveBeenCalled()

    // A terminal frame finishes the pump (the gateway closes the SSE after it).
    gateway.stream('r1').push({ event: 'run.completed', run_id: 'r1', output: 'done' })
    await settle()

    // The reaper interval is cleared since there is nothing left to watch.
    expect(manager.isActive('r1')).toBe(false)
    expect(clearSpy).toHaveBeenCalled()
  })
})

describe('RunManager max-concurrent-pumps cap', () => {
  it('refuses to start a pump beyond the cap and synthesizes run.failed so the client never hangs', async () => {
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store, { maxConcurrentPumps: 2 })

    manager.start('r1')
    manager.start('r2')
    expect(manager.isActive('r1')).toBe(true)
    expect(manager.isActive('r2')).toBe(true)

    // Third start is over the cap: no pump is launched, but the run is made
    // terminal (run.failed) immediately so the issuing client doesn't wait forever.
    manager.start('r3')
    expect(manager.isActive('r3')).toBe(false)
    expect(store.isDone('r3')).toBe(true)
    const terminal = store.snapshot('r3', 0).at(-1)
    expect(terminal?.event).toBe('run.failed')

    // Freeing a slot lets a later run start normally.
    gateway.stream('r1').push({ event: 'run.completed', run_id: 'r1', output: 'ok' })
    await settle()
    expect(manager.isActive('r1')).toBe(false)
    manager.start('r4')
    expect(manager.isActive('r4')).toBe(true)
  })

  it('makes the over-cap run terminal exactly once (a single run.failed)', () => {
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store, { maxConcurrentPumps: 1 })
    manager.start('r1')
    manager.start('r2') // over cap → run.failed
    const events = store.snapshot('r2', 0)
    expect(events.length).toBe(1)
    expect(events[0]?.event).toBe('run.failed')
  })
})

describe('RunManager per-run usage relay (the receipt source)', () => {
  // The gateway's run.completed usage is EXACT for the run: api_server creates a
  // fresh agent per /v1/runs run whose token counters start at 0 and count only
  // that run's own model calls. The pump must relay it VERBATIM into the durable
  // store — the web's receipt line renders these numbers, so any coercion or
  // default here would be a fabricated receipt.
  it('relays run.completed usage verbatim into the replay log', async () => {
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store)
    manager.start('r1', 'sess-1')
    gateway.stream('r1').push({
      event: 'run.completed',
      run_id: 'r1',
      output: 'done',
      usage: { input_tokens: 64321, output_tokens: 1234, total_tokens: 65555 },
    })
    await settle()
    const terminal = store.snapshot('r1', 0).at(-1)
    expect(terminal?.event).toBe('run.completed')
    expect(terminal && 'usage' in terminal ? terminal.usage : undefined).toEqual({
      input_tokens: 64321,
      output_tokens: 1234,
      total_tokens: 65555,
    })
  })

  it('keeps usage ABSENT when the gateway omitted it — never fabricates zeros', async () => {
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store)
    manager.start('r1')
    gateway.stream('r1').push({ event: 'run.completed', run_id: 'r1', output: 'done' })
    await settle()
    const terminal = store.snapshot('r1', 0).at(-1)
    expect(terminal?.event).toBe('run.completed')
    expect(terminal && 'usage' in terminal ? terminal.usage : undefined).toBeUndefined()
  })
})

describe('mapGatewayEvent — unknown terminal event catch-all', () => {
  it('passes known protocol events through unchanged', () => {
    const ev = mapGatewayEvent(
      { event: 'run.completed', run_id: 'r1', output: 'ok' },
      { runId: 'r1' },
    )
    expect(ev?.event).toBe('run.completed')
  })

  it('returns null for unknown non-terminal events (no hang, no spurious terminal)', () => {
    const ev = mapGatewayEvent({ event: 'run.archived', run_id: 'r1' } as never, { runId: 'r1' })
    expect(ev).toBeNull()
  })

  it('synthesizes run.failed for an unknown event ending in .completed', () => {
    // A future Hermes might emit `run.archived.completed` or similar. We must not
    // let the run hang for 120s — map it to run.failed immediately.
    const ev = mapGatewayEvent({ event: 'run.transfer.completed', run_id: 'r1' } as never, {
      runId: 'r1',
    })
    expect(ev?.event).toBe('run.failed')
    if (ev?.event === 'run.failed') {
      expect(ev.error).toContain('run.transfer.completed')
    }
  })

  it('synthesizes run.failed for an unknown event ending in .failed', () => {
    const ev = mapGatewayEvent({ event: 'task.failed', run_id: 'r1' } as never, { runId: 'r1' })
    expect(ev?.event).toBe('run.failed')
  })

  it('synthesizes run.failed for an unknown event ending in .cancelled', () => {
    const ev = mapGatewayEvent({ event: 'run.v2.cancelled', run_id: 'r1' } as never, {
      runId: 'r1',
    })
    expect(ev?.event).toBe('run.failed')
  })

  it('stamps session_id on the synthesized run.failed when ctx provides one', () => {
    const ev = mapGatewayEvent({ event: 'run.transfer.completed', run_id: 'r1' } as never, {
      runId: 'r1',
      sessionId: 'sess_abc',
    })
    expect(ev?.session_id).toBe('sess_abc')
  })

  it('unknown terminal event is appended to store and makes the run terminal immediately', async () => {
    const gateway = new ScriptedGateway()
    const store = new RunStore()
    const manager = new RunManager(gateway, store)

    manager.start('r1')
    // Push an unknown terminal event (future Hermes format).
    gateway.stream('r1').push({ event: 'run.v2.completed', run_id: 'r1' } as never)
    await settle()

    expect(store.isDone('r1')).toBe(true)
    const terminal = store.snapshot('r1', 0).at(-1)
    expect(terminal?.event).toBe('run.failed')
  })
})
