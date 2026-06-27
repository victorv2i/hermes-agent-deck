import { describe, it, expect, beforeEach } from 'vitest'
import type { ChatServerEvent } from '@agent-deck/protocol'
import {
  ChatSocket,
  ACTIVE_RUN_STORAGE_KEY,
  readPersistedRun,
  writePersistedRun,
  type SocketLike,
  type StorageLike,
  type ConnectionStatus,
  type CommandError,
  type ConnectionError,
} from './chatSocket'

/** An in-memory Web Storage stand-in for the reload-resume tests. */
class FakeStorage implements StorageLike {
  store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
}

/** A scriptable stand-in for socket.io's Manager (`socket.io`): the reconnect
 * lifecycle events (`reconnect_attempt`, `reconnect`, `reconnect_failed`) are
 * emitted here, not on the socket. */
class FakeManager {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  on(event: string, listener: (...args: unknown[]) => void): this {
    const arr = this.listeners.get(event) ?? []
    arr.push(listener)
    this.listeners.set(event, arr)
    return this
  }
  off(event: string, listener?: (...args: unknown[]) => void): this {
    if (!listener) this.listeners.delete(event)
    else {
      const arr = this.listeners.get(event) ?? []
      this.listeners.set(
        event,
        arr.filter((l) => l !== listener),
      )
    }
    return this
  }
  /** Test helper: deliver a manager lifecycle event to its listeners. */
  dispatch(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }
}

/** A scriptable socket.io-client stand-in: records outbound emits and lets a
 * test inject inbound server frames / lifecycle events. No network. */
class FakeSocket implements SocketLike {
  connected = false
  /** Mirrors socket.io's `socket.active`: true while the manager will auto-
   * reconnect (transient drop), false once the link is terminally closed. */
  active = true
  /** Mirrors socket.io's manager handle (`socket.io`) for reconnect events. */
  io = new FakeManager()
  emitted: Array<{ event: string; args: unknown[] }> = []
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  connectCalls = 0
  disconnectCalls = 0

  on(event: string, listener: (...args: unknown[]) => void): this {
    const arr = this.listeners.get(event) ?? []
    arr.push(listener)
    this.listeners.set(event, arr)
    return this
  }

  off(event: string, listener?: (...args: unknown[]) => void): this {
    if (!listener) this.listeners.delete(event)
    else {
      const arr = this.listeners.get(event) ?? []
      this.listeners.set(
        event,
        arr.filter((l) => l !== listener),
      )
    }
    return this
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args })
    return this
  }

  connect(): this {
    this.connectCalls++
    this.connected = true
    return this
  }

  disconnect(): this {
    this.disconnectCalls++
    this.connected = false
    return this
  }

  /** Test helper: deliver an inbound event to all registered listeners. */
  dispatch(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }

  lastEmit(event: string): unknown[] | undefined {
    for (let i = this.emitted.length - 1; i >= 0; i--) {
      if (this.emitted[i]!.event === event) return this.emitted[i]!.args
    }
    return undefined
  }
}

interface Harness {
  socket: FakeSocket
  client: ChatSocket
  events: ChatServerEvent[]
  statuses: ConnectionStatus[]
  errors: CommandError[]
  /** Terminal-disconnect errors (a transient drop must NOT push one here). */
  connectionErrors: ConnectionError[]
}

function setup(): Harness {
  const socket = new FakeSocket()
  const events: ChatServerEvent[] = []
  const statuses: ConnectionStatus[] = []
  const errors: CommandError[] = []
  const connectionErrors: ConnectionError[] = []
  const client = new ChatSocket(
    {
      onEvent: (e) => events.push(e),
      onStatusChange: (s) => statuses.push(s),
      onCommandError: (e) => errors.push(e),
      onConnectionError: (e) => connectionErrors.push(e),
    },
    // Disable persistence by default so these transport tests stay hermetic
    // (the reload-resume suite below injects its own fake storage).
    { socket, storage: null },
  )
  return { socket, client, events, statuses, errors, connectionErrors }
}

describe('ChatSocket commands', () => {
  let h: Harness
  beforeEach(() => {
    h = setup()
  })

  it('run emits a validated run command and resets cursor tracking', () => {
    expect(h.client.run({ input: 'hello', model: 'm', session_id: 's' })).toBe(true)
    expect(h.socket.lastEmit('run')).toEqual([{ input: 'hello', model: 'm', session_id: 's' }])
    expect(h.client.lastCursor).toBe(0)
  })

  it('run rejects an invalid command without emitting', () => {
    // input must be a string.
    expect(h.client.run({ input: 123 } as unknown as { input: string })).toBe(false)
    expect(h.socket.lastEmit('run')).toBeUndefined()
  })

  it('abort emits a validated abort command', () => {
    expect(h.client.abort({ run_id: 'run_1' })).toBe(true)
    expect(h.socket.lastEmit('abort')).toEqual([{ run_id: 'run_1' }])
  })

  it('respondApproval emits under the approval.respond event name', () => {
    expect(h.client.respondApproval({ run_id: 'run_1', approval_id: 'a1', choice: 'once' })).toBe(
      true,
    )
    expect(h.socket.lastEmit('approval.respond')).toEqual([
      { run_id: 'run_1', approval_id: 'a1', choice: 'once' },
    ])
  })

  it('respondApproval rejects a bad choice', () => {
    expect(
      h.client.respondApproval({
        run_id: 'run_1',
        choice: 'nope' as unknown as 'once',
      }),
    ).toBe(false)
    expect(h.socket.lastEmit('approval.respond')).toBeUndefined()
  })
})

describe('ChatSocket inbound frames', () => {
  let h: Harness
  beforeEach(() => {
    h = setup()
  })

  it('validates and forwards each named ChatServerEvent, tracking the cursor', () => {
    h.client.run({ input: 'x' }) // tail OUR run; frames only forward for the run we started
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'hi',
      cursor: 2,
    })
    expect(h.events.map((e) => e.event)).toEqual(['run.started', 'message.delta'])
    expect(h.client.lastCursor).toBe(2)
    expect(h.client.runId).toBe('run_1')
  })

  it('drops a FOREIGN run (one this client never started) so a background cron run cannot overtake the view', () => {
    // The client is idle (the user is composing a new chat; no run() was called).
    // A broadcast run.started + frames for someone else's run (e.g. a cron) must
    // be ignored, not adopted and streamed into this transcript.
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'cron_run', cursor: 1 })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'cron_run',
      delta: 'echo hi',
      cursor: 2,
    })
    expect(h.events).toHaveLength(0)
    expect(h.client.runId).toBeNull()
  })

  it('detach() stops tailing the started run so its later frames are dropped (new-chat isolation)', () => {
    // Tail OUR run and take a couple of frames (a live session).
    h.client.run({ input: 'x' })
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'hi',
      cursor: 2,
    })
    expect(h.events.map((e) => e.event)).toEqual(['run.started', 'message.delta'])

    // The user opens a NEW chat: stop tailing run_1 (it keeps running server-side,
    // resumable from history, and detach must NOT abort it).
    h.client.detach()
    expect(h.client.runId).toBeNull()
    expect(h.socket.lastEmit('abort')).toBeUndefined()

    // run_1 is still working; its later frames must NOT forward into the new view.
    h.socket.dispatch('tool.started', {
      event: 'tool.started',
      run_id: 'run_1',
      tool: 'bash',
      cursor: 3,
    })
    expect(h.events.map((e) => e.event)).toEqual(['run.started', 'message.delta'])
  })

  it('drops a frame that fails schema validation', () => {
    // message.delta requires a string `delta`.
    h.socket.dispatch('message.delta', { event: 'message.delta', run_id: 'run_1', cursor: 1 })
    expect(h.events).toHaveLength(0)
    expect(h.client.lastCursor).toBe(0)
  })

  it('a cursor-less transient frame (run.stopping) forwards without moving the cursor', () => {
    h.client.run({ input: 'x' })
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 3 })
    h.socket.dispatch('run.stopping', { event: 'run.stopping', run_id: 'run_1' })
    expect(h.events.map((e) => e.event)).toEqual(['run.started', 'run.stopping'])
    expect(h.client.lastCursor).toBe(3)
  })

  it('forwards a BFF command.error to the callback', () => {
    h.socket.dispatch('command.error', { command: 'run', message: 'invalid run command' })
    expect(h.errors).toEqual([{ command: 'run', message: 'invalid run command' }])
  })
})

describe('ChatSocket durable replay-tail on reconnect', () => {
  let h: Harness
  beforeEach(() => {
    h = setup()
  })

  it('on (re)connect with an in-flight run, auto-resumes from the last cursor', () => {
    // Drive a run and stream a couple of frames.
    h.client.run({ input: 'go' })
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'par',
      cursor: 2,
    })
    expect(h.client.lastCursor).toBe(2)

    // Link drops and re-establishes (socket.io fires 'connect' again).
    h.socket.dispatch('connect')

    // The client should have auto-emitted resume from cursor 2 for run_1.
    expect(h.socket.lastEmit('resume')).toEqual([{ run_id: 'run_1', after_cursor: 2 }])
    // And reported reconnection.
    expect(h.statuses).toContain('connected')
  })

  it('does NOT auto-resume a run that already reached a terminal frame', () => {
    h.client.run({ input: 'go' })
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    h.socket.dispatch('run.completed', {
      event: 'run.completed',
      run_id: 'run_1',
      output: 'done',
      cursor: 2,
    })
    h.socket.dispatch('connect')
    expect(h.socket.lastEmit('resume')).toBeUndefined()
  })

  it('does not resume when there is no active run', () => {
    h.socket.dispatch('connect')
    expect(h.socket.lastEmit('resume')).toBeUndefined()
  })

  it('replay overlap is dropped at the client (cursor watermark never regresses)', () => {
    // Seen cursors 1..2 live.
    h.client.run({ input: 'go' })
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'Hello ',
      cursor: 2,
    })
    const beforeReplay = h.events.length

    // Reconnect → auto-resume; BFF replays 1..2 (overlap) then new tail 3..4.
    h.socket.dispatch('connect')
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'Hello ',
      cursor: 2,
    })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'world',
      cursor: 3,
    })
    h.socket.dispatch('run.completed', {
      event: 'run.completed',
      run_id: 'run_1',
      output: 'Hello world',
      cursor: 4,
    })

    // Only the genuinely-new frames (cursor 3, 4) crossed the boundary.
    const newlyForwarded = h.events.slice(beforeReplay)
    expect(newlyForwarded.map((e) => e.cursor)).toEqual([3, 4])
    expect(h.client.lastCursor).toBe(4)
  })

  it('connect() opens the transport and reports connecting', () => {
    h.client.connect()
    expect(h.socket.connectCalls).toBe(1)
    expect(h.statuses[0]).toBe('connecting')
  })

  it('dispose() removes listeners and disconnects', () => {
    h.client.dispose()
    expect(h.socket.disconnectCalls).toBe(1)
    // After disposal, a late inbound frame must not reach the callback.
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'late',
      cursor: 9,
    })
    expect(h.events).toHaveLength(0)
  })
})

describe('ChatSocket disconnect classification', () => {
  let h: Harness
  beforeEach(() => {
    h = setup()
  })

  it('a transient drop (socket.active) → reconnecting, with NO terminal error', () => {
    // socket.io sets `socket.active === true` when the manager will auto-
    // reconnect (network blip, server restart, transport close/ping timeout).
    h.socket.active = true
    h.socket.dispatch('disconnect', 'transport close')

    // Calm reconnecting state — never the offline/terminal state, and no error.
    expect(h.statuses).toContain('reconnecting')
    expect(h.statuses).not.toContain('disconnected')
    expect(h.connectionErrors).toHaveLength(0)
  })

  it('reconnect_attempt stays in the reconnecting state (no flapping to disconnected)', () => {
    h.socket.active = true
    h.socket.dispatch('disconnect', 'ping timeout')
    h.socket.io.dispatch('reconnect_attempt', 1)
    h.socket.io.dispatch('reconnect_attempt', 2)

    // Each attempt re-affirms the calm state; never a terminal flash.
    expect(h.statuses.filter((s) => s === 'reconnecting').length).toBeGreaterThanOrEqual(1)
    expect(h.statuses).not.toContain('disconnected')
    expect(h.connectionErrors).toHaveLength(0)
  })

  it('a successful reconnect returns to connected and replays the in-flight run', () => {
    h.client.run({ input: 'go' })
    h.socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    h.socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'par',
      cursor: 2,
    })

    // Transient drop → reconnecting; the manager then reconnects and the socket
    // fires its 'connect' again (the existing replay-tail path).
    h.socket.active = true
    h.socket.dispatch('disconnect', 'transport close')
    h.socket.io.dispatch('reconnect_attempt', 1)
    h.socket.io.dispatch('reconnect', 1)
    h.socket.dispatch('connect')

    // Back to connected, replay resumes from the last cursor (advantage intact).
    expect(h.statuses).toContain('connected')
    expect(h.socket.lastEmit('resume')).toEqual([{ run_id: 'run_1', after_cursor: 2 }])
    expect(h.connectionErrors).toHaveLength(0)
  })

  it('a terminal close (server-forced, !socket.active) → disconnected AND a terminal error', () => {
    // socket.io sets `socket.active === false` when the server forcefully closed
    // the connection (e.g. auth rejected, run truly gone) — no auto-reconnect.
    h.socket.active = false
    h.socket.dispatch('disconnect', 'io server disconnect')

    expect(h.statuses).toContain('disconnected')
    expect(h.statuses).not.toContain('reconnecting')
    expect(h.connectionErrors).toHaveLength(1)
    expect(h.connectionErrors[0]!.reason).toBe('io server disconnect')
  })

  it('reconnect_failed (gave up after retries) escalates a transient drop to terminal', () => {
    // A transient drop starts calm…
    h.socket.active = true
    h.socket.dispatch('disconnect', 'transport close')
    expect(h.statuses).toContain('reconnecting')
    expect(h.connectionErrors).toHaveLength(0)

    // …but if the manager exhausts its attempts, that becomes a real failure.
    h.socket.io.dispatch('reconnect_failed')
    expect(h.statuses).toContain('disconnected')
    expect(h.connectionErrors).toHaveLength(1)
  })

  it('a deliberate dispose() (io client disconnect) surfaces neither a state nor an error', () => {
    h.client.dispose()
    // dispose() calls socket.disconnect(); socket.io then fires a terminal
    // 'disconnect' with reason 'io client disconnect'. That is OUR teardown, not
    // a failure — it must stay silent.
    h.socket.active = false
    h.socket.dispatch('disconnect', 'io client disconnect')
    expect(h.statuses).not.toContain('disconnected')
    expect(h.statuses).not.toContain('reconnecting')
    expect(h.connectionErrors).toHaveLength(0)
  })
})

describe('reload-resume persistence', () => {
  it('readPersistedRun / writePersistedRun round-trip and clear', () => {
    const storage = new FakeStorage()
    expect(readPersistedRun(storage)).toBeNull()
    writePersistedRun({ runId: 'run_9', lastCursor: 7 }, storage)
    expect(storage.getItem(ACTIVE_RUN_STORAGE_KEY)).toContain('run_9')
    expect(readPersistedRun(storage)).toEqual({ runId: 'run_9', lastCursor: 7 })
    writePersistedRun(null, storage)
    expect(readPersistedRun(storage)).toBeNull()
  })

  it('readPersistedRun ignores malformed JSON', () => {
    const storage = new FakeStorage()
    storage.setItem(ACTIVE_RUN_STORAGE_KEY, '{not json')
    expect(readPersistedRun(storage)).toBeNull()
  })

  it('readPersistedRun ignores a wrong-shaped record', () => {
    const storage = new FakeStorage()
    storage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify({ runId: 'x' })) // no cursor
    expect(readPersistedRun(storage)).toBeNull()
  })

  it('persists {runId, lastCursor} as an in-flight run streams', () => {
    const storage = new FakeStorage()
    const socket = new FakeSocket()
    const client = new ChatSocket({ onEvent: () => {} }, { socket, storage })
    client.run({ input: 'go' })
    socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    socket.dispatch('message.delta', {
      event: 'message.delta',
      run_id: 'run_1',
      delta: 'hi',
      cursor: 2,
    })
    expect(readPersistedRun(storage)).toEqual({ runId: 'run_1', lastCursor: 2 })
  })

  it('clears the persisted run on a terminal frame', () => {
    const storage = new FakeStorage()
    const socket = new FakeSocket()
    const client = new ChatSocket({ onEvent: () => {} }, { socket, storage })
    client.run({ input: 'go' })
    socket.dispatch('run.started', { event: 'run.started', run_id: 'run_1', cursor: 1 })
    expect(readPersistedRun(storage)).not.toBeNull()
    socket.dispatch('run.completed', {
      event: 'run.completed',
      run_id: 'run_1',
      output: 'done',
      cursor: 2,
    })
    expect(readPersistedRun(storage)).toBeNull()
  })

  it('a fresh run() clears a stale persisted run before re-persisting', () => {
    const storage = new FakeStorage()
    writePersistedRun({ runId: 'stale', lastCursor: 99 }, storage)
    const socket = new FakeSocket()
    const client = new ChatSocket({ onEvent: () => {} }, { socket, storage })
    client.run({ input: 'go' })
    // After run() (before any frame) the stale record is gone.
    expect(readPersistedRun(storage)).toBeNull()
  })

  it('restores a persisted run on construction and auto-resumes the WHOLE run on connect', () => {
    const storage = new FakeStorage()
    // Simulate a prior page-load mid-run that persisted run_1 @ cursor 5.
    writePersistedRun({ runId: 'run_1', lastCursor: 5 }, storage)
    const socket = new FakeSocket()
    // A fresh client (as if after a full page reload) adopts the persisted run.
    const client = new ChatSocket({ onEvent: () => {} }, { socket, storage })
    expect(client.runId).toBe('run_1')
    // The reload lost every in-memory frame, so the resume replays from 0 —
    // resuming from the dead page's cursor (5) would rebuild an empty transcript
    // and silently drop a still-pending approval received before the reload.
    expect(client.lastCursor).toBe(0)
    socket.dispatch('connect')
    expect(socket.lastEmit('resume')).toEqual([{ run_id: 'run_1', after_cursor: 0 }])
  })

  it('does not adopt or resume when storage holds no run', () => {
    const storage = new FakeStorage()
    const socket = new FakeSocket()
    const client = new ChatSocket({ onEvent: () => {} }, { socket, storage })
    expect(client.runId).toBeNull()
    socket.dispatch('connect')
    expect(socket.lastEmit('resume')).toBeUndefined()
  })
})

describe('ChatSocket cross-device approval broadcasts', () => {
  it('validates and forwards approval.pending / approval.cleared to the callbacks', () => {
    const socket = new FakeSocket()
    const pending: unknown[] = []
    const cleared: unknown[] = []
    new ChatSocket(
      {
        onEvent: () => {},
        onApprovalPending: (info) => pending.push(info),
        onApprovalCleared: (info) => cleared.push(info),
      },
      { socket, storage: null },
    )

    socket.dispatch('approval.pending', {
      run_id: 'run_x',
      session_id: 'sess_x',
      command: 'rm -rf ./build',
      description: 'delete build',
    })
    socket.dispatch('approval.cleared', { run_id: 'run_x' })

    expect(pending).toEqual([
      {
        run_id: 'run_x',
        session_id: 'sess_x',
        command: 'rm -rf ./build',
        description: 'delete build',
      },
    ])
    expect(cleared).toEqual([{ run_id: 'run_x' }])
  })

  it('drops a malformed approval broadcast (no run_id)', () => {
    const socket = new FakeSocket()
    const pending: unknown[] = []
    new ChatSocket(
      { onEvent: () => {}, onApprovalPending: (info) => pending.push(info) },
      { socket, storage: null },
    )
    socket.dispatch('approval.pending', { command: 'no run id' })
    expect(pending).toEqual([])
  })
})
