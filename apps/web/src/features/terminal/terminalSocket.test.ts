import { describe, it, expect, vi } from 'vitest'
import { TerminalSocket, type TerminalSocketLike } from './terminalSocket'

/** A fake socket.io transport: records emits, lets the test fire server events. */
class FakeSocket implements TerminalSocketLike {
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
  off(event: string, listener?: (...a: unknown[]) => void) {
    if (!listener) this.handlers.delete(event)
    else
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((l) => l !== listener),
      )
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
    this.fire('disconnect')
    return this
  }
  /** Test helper: dispatch a server→client event. */
  fire(event: string, ...args: unknown[]) {
    for (const l of this.handlers.get(event) ?? []) l(...args)
  }
  emitsFor(event: string) {
    return this.emits.filter((e) => e.event === event)
  }
}

describe('TerminalSocket', () => {
  it('sends terminal.start once connected, with the requested geometry', () => {
    const fake = new FakeSocket()
    const t = new TerminalSocket({ onData: vi.fn() }, { socket: fake })
    t.start({ cols: 100, rows: 30, cwd: '/work' })
    expect(fake.emitsFor('terminal.start')).toHaveLength(0) // buffered until connect
    t.connect()
    expect(fake.connectCalls).toBe(1)
    const starts = fake.emitsFor('terminal.start')
    expect(starts).toHaveLength(1)
    expect(starts[0]!.args[0]).toEqual({ cols: 100, rows: 30, cwd: '/work' })
  })

  it('forwards an optional CLI preset id in terminal.start', () => {
    const fake = new FakeSocket()
    const t = new TerminalSocket({ onData: vi.fn() }, { socket: fake })
    t.start({ cols: 80, rows: 24, cli: 'hermes' })
    t.connect()
    const starts = fake.emitsFor('terminal.start')
    expect(starts).toHaveLength(1)
    expect(starts[0]!.args[0]).toEqual({ cols: 80, rows: 24, cli: 'hermes' })
  })

  it('sends start once and is idempotent while connected', () => {
    const fake = new FakeSocket()
    const t = new TerminalSocket({ onData: vi.fn() }, { socket: fake })
    t.start({ cols: 80, rows: 24 })
    t.connect()
    t.start({ cols: 80, rows: 24 }) // idempotent while connected
    expect(fake.emitsFor('terminal.start')).toHaveLength(1)
  })

  it('does NOT silently re-spawn a fresh shell on reconnect — surfaces a dropped state', () => {
    // The server force-kills the pty on disconnect, so the prior shell (scrollback
    // + processes) is gone. A reconnect must NOT re-`start` a brand-new shell that
    // masquerades as the same session — it surfaces 'dropped' + onReconnectDropped.
    const onStatusChange = vi.fn()
    const onReconnectDropped = vi.fn()
    const fake = new FakeSocket()
    const t = new TerminalSocket(
      { onData: vi.fn(), onStatusChange, onReconnectDropped },
      { socket: fake },
    )
    t.start({ cols: 80, rows: 24 })
    t.connect()
    expect(fake.emitsFor('terminal.start')).toHaveLength(1)

    fake.disconnect()
    expect(onStatusChange).toHaveBeenCalledWith('disconnected')

    onStatusChange.mockClear()
    fake.connect() // reconnect — must NOT re-open a shell
    expect(fake.emitsFor('terminal.start')).toHaveLength(1) // no second start
    expect(onStatusChange).toHaveBeenCalledWith('dropped')
    expect(onStatusChange).not.toHaveBeenCalledWith('connected')
    expect(onReconnectDropped).toHaveBeenCalledTimes(1)
  })

  it('forwards a stable sessionId in terminal.start (park/reattach)', () => {
    const fake = new FakeSocket()
    const t = new TerminalSocket({ onData: vi.fn() }, { socket: fake })
    t.start({ cols: 80, rows: 24, sessionId: 'term-1:0' })
    t.connect()
    const starts = fake.emitsFor('terminal.start')
    expect(starts).toHaveLength(1)
    expect(starts[0]!.args[0]).toEqual({ cols: 80, rows: 24, sessionId: 'term-1:0' })
  })

  it('RE-STARTS to reattach on reconnect when a stable sessionId is present', () => {
    // With a stable sessionId the server parks the pty, so a reconnect re-`start`s
    // to REATTACH (same shell resumes) instead of surfacing 'dropped'.
    const onStatusChange = vi.fn()
    const onReconnectDropped = vi.fn()
    const fake = new FakeSocket()
    const t = new TerminalSocket(
      { onData: vi.fn(), onStatusChange, onReconnectDropped },
      { socket: fake },
    )
    t.start({ cols: 80, rows: 24, sessionId: 'term-7:2' })
    t.connect()
    expect(fake.emitsFor('terminal.start')).toHaveLength(1)

    fake.disconnect()
    onStatusChange.mockClear()
    fake.connect() // reconnect — must re-start to reattach
    const starts = fake.emitsFor('terminal.start')
    expect(starts).toHaveLength(2)
    expect(starts[1]!.args[0]).toEqual({ cols: 80, rows: 24, sessionId: 'term-7:2' })
    expect(onReconnectDropped).not.toHaveBeenCalled()
  })

  it('reports connected + onResumed when the server replies resumed=true', () => {
    const onStatusChange = vi.fn()
    const onResumed = vi.fn()
    const onReady = vi.fn()
    const fake = new FakeSocket()
    new TerminalSocket({ onData: vi.fn(), onStatusChange, onResumed, onReady }, { socket: fake })
    fake.fire('terminal.ready', { pid: 555, resumed: true })
    expect(onReady).toHaveBeenCalledWith({ pid: 555 })
    expect(onResumed).toHaveBeenCalledTimes(1)
    expect(onStatusChange).toHaveBeenCalledWith('connected')
  })

  it('routes terminal.data to onData', () => {
    const onData = vi.fn()
    const fake = new FakeSocket()
    new TerminalSocket({ onData }, { socket: fake })
    fake.fire('terminal.data', 'hello\r\n')
    expect(onData).toHaveBeenCalledWith('hello\r\n')
    fake.fire('terminal.data', 12345) // ignored — not a string
    expect(onData).toHaveBeenCalledTimes(1)
  })

  it('routes terminal.ready/exit/error to their callbacks + status', () => {
    const onReady = vi.fn()
    const onExit = vi.fn()
    const onError = vi.fn()
    const onStatusChange = vi.fn()
    const fake = new FakeSocket()
    new TerminalSocket(
      { onData: vi.fn(), onReady, onExit, onError, onStatusChange },
      { socket: fake },
    )

    fake.fire('terminal.ready', { pid: 4242 })
    expect(onReady).toHaveBeenCalledWith({ pid: 4242 })

    fake.fire('terminal.exit', { exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0 })
    expect(onStatusChange).toHaveBeenCalledWith('exited')

    fake.fire('terminal.error', { message: 'Terminal unavailable: ...' })
    expect(onError).toHaveBeenCalledWith({ message: 'Terminal unavailable: ...' })
    expect(onStatusChange).toHaveBeenCalledWith('error')
  })

  it('forwards input and resize to the wire', () => {
    const fake = new FakeSocket()
    const t = new TerminalSocket({ onData: vi.fn() }, { socket: fake })
    t.connect()
    t.input('ls -la\r')
    t.resize(120, 40)
    expect(fake.emitsFor('terminal.input')[0]!.args[0]).toBe('ls -la\r')
    expect(fake.emitsFor('terminal.resize')[0]!.args[0]).toEqual({ cols: 120, rows: 40 })
  })

  it('dispose closes the transport and stops emitting', () => {
    const fake = new FakeSocket()
    const t = new TerminalSocket({ onData: vi.fn() }, { socket: fake })
    t.connect()
    t.dispose()
    expect(fake.disconnectCalls).toBe(1)
    t.input('x') // no-op after dispose
    expect(fake.emitsFor('terminal.input')).toHaveLength(0)
  })

  it('emits status transitions on connect/disconnect/error', () => {
    const onStatusChange = vi.fn()
    const fake = new FakeSocket()
    const t = new TerminalSocket({ onData: vi.fn(), onStatusChange }, { socket: fake })
    t.connect()
    expect(onStatusChange).toHaveBeenCalledWith('connecting')
    expect(onStatusChange).toHaveBeenCalledWith('connected')
    fake.fire('connect_error')
    expect(onStatusChange).toHaveBeenCalledWith('error')
  })
})
