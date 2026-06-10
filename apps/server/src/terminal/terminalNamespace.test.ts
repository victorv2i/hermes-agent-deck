import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import type { Server as SocketIOServer } from 'socket.io'
import {
  attachTerminal,
  isLoopbackOrigin,
  TERMINAL_NAMESPACE,
  type TerminalOptions,
  type TerminalAuditEvent,
} from './terminalNamespace'
import type { NodePtyLike, PtyProcess } from './ptyBridge'

/** A controllable fake pty so the namespace can be tested without a real shell. */
class FakeProc implements PtyProcess {
  readonly pid: number
  written: string[] = []
  resized: { cols: number; rows: number }[] = []
  killed = false
  private dataCb?: (d: string) => void
  private exitCb?: (e: { exitCode: number }) => void
  constructor(pid = 1234) {
    this.pid = pid
  }
  onData(cb: (d: string) => void) {
    this.dataCb = cb
  }
  onExit(cb: (e: { exitCode: number }) => void) {
    this.exitCb = cb
  }
  write(d: string) {
    this.written.push(d)
  }
  resize(cols: number, rows: number) {
    this.resized.push({ cols, rows })
  }
  kill() {
    this.killed = true
  }
  pushData(d: string) {
    this.dataCb?.(d)
  }
  pushExit(code: number) {
    this.exitCb?.({ exitCode: code })
  }
}

function fakeNodePty(): { mod: NodePtyLike; procs: FakeProc[] } {
  const procs: FakeProc[] = []
  const mod: NodePtyLike = {
    spawn() {
      const proc = new FakeProc(1000 + procs.length)
      procs.push(proc)
      return proc
    },
  }
  return { mod, procs }
}

let http: HttpServer | undefined
let io: SocketIOServer | undefined
const clients: ClientSocket[] = []

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect()
  await io?.close()
  io = undefined
  if (http) {
    const server = http
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  http = undefined
})

/** Boot an HTTP server + terminal namespace; return the base URL + handles.
 * Defaults allowHome so the happy-path tests spawn at $HOME without needing a
 * real workspace root on disk (the no-$HOME refusal is covered separately). */
async function boot(options: TerminalOptions = {}): Promise<{ url: string; procs: FakeProc[] }> {
  const { mod, procs } = fakeNodePty()
  http = createServer()
  io = attachTerminal(http, { nodePty: mod, allowHome: true, ...options })
  await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
  const { port } = http!.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, procs }
}

function connect(url: string, opts: Record<string, unknown> = {}): ClientSocket {
  const c = ioClient(`${url}${TERMINAL_NAMESPACE}`, {
    transports: ['websocket'],
    forceNew: true,
    ...opts,
  })
  clients.push(c)
  return c
}

function waitFor<T = unknown>(socket: ClientSocket, event: string, ms = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms)
    socket.once(event, (payload: T) => {
      clearTimeout(t)
      resolve(payload)
    })
  })
}

describe('isLoopbackOrigin', () => {
  it('accepts loopback / localhost / *.ts.net, rejects public', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isLoopbackOrigin('http://localhost:5173')).toBe(true)
    expect(isLoopbackOrigin('http://box.tail1234.ts.net')).toBe(true)
    expect(isLoopbackOrigin('https://evil.example.com')).toBe(false)
    expect(isLoopbackOrigin('not-a-url')).toBe(false)
  })
})

describe('/agent-deck-terminal namespace', () => {
  it('spawns a pty on start and emits terminal.ready with a pid', async () => {
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    const ready = waitFor<{ pid: number }>(c, 'terminal.ready')
    c.emit('terminal.start', { cols: 100, rows: 30 })
    const r = await ready
    expect(r.pid).toBe(1000)
    expect(procs).toHaveLength(1)
  })

  it('streams pty output to the client as terminal.data', async () => {
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')
    const data = waitFor<string>(c, 'terminal.data')
    procs[0]!.pushData('hello\r\n')
    expect(await data).toBe('hello\r\n')
  })

  it('forwards client input to the pty', async () => {
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')
    c.emit('terminal.input', 'ls -la\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(procs[0]!.written).toContain('ls -la\r')
  })

  it('resizes the pty (clamped) on terminal.resize', async () => {
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')
    c.emit('terminal.resize', { cols: 120.9, rows: 40 })
    await new Promise((r) => setTimeout(r, 50))
    expect(procs[0]!.resized).toContainEqual({ cols: 120, rows: 40 })
  })

  it('emits terminal.exit and kills the pty when the shell exits', async () => {
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')
    const exit = waitFor<{ exitCode: number }>(c, 'terminal.exit')
    procs[0]!.pushExit(0)
    expect((await exit).exitCode).toBe(0)
    expect(procs[0]!.killed).toBe(true)
  })

  it('kills the pty on socket disconnect (no orphan shells)', async () => {
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')
    c.disconnect()
    await new Promise((r) => setTimeout(r, 100))
    expect(procs[0]!.killed).toBe(true)
  })

  it('enforces the session cap with a calm terminal.error', async () => {
    const { url, procs } = await boot({ maxSessions: 1 })
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', {})
    await waitFor(c1, 'terminal.ready')

    const c2 = connect(url)
    await waitFor(c2, 'connect')
    const err = waitFor<{ message: string }>(c2, 'terminal.error')
    c2.emit('terminal.start', {})
    expect((await err).message).toMatch(/too many/i)
    expect(procs).toHaveLength(1) // second never spawned
  })

  it('degrades honestly when node-pty is unavailable', async () => {
    http = createServer()
    io = attachTerminal(http, { nodePty: async () => null })
    await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
    const { port } = http.address() as AddressInfo
    const c = connect(`http://127.0.0.1:${port}`)
    await waitFor(c, 'connect')
    const err = waitFor<{ message: string }>(c, 'terminal.error')
    c.emit('terminal.start', {})
    expect((await err).message).toMatch(/unavailable/i)
  })

  it('refuses a non-loopback Origin at the handshake', async () => {
    const { url } = await boot()
    const c = connect(url, { extraHeaders: { Origin: 'https://evil.example.com' } })
    const connectErr = waitFor<Error>(c, 'connect_error')
    await expect(
      Promise.race([
        connectErr,
        waitFor(c, 'connect').then(() => {
          throw new Error('should not have connected')
        }),
      ]),
    ).resolves.toBeDefined()
  })
})

describe('/agent-deck-terminal CLI preset launch', () => {
  it('seeds the preset command into the pty after the shell is ready', async () => {
    // An available preset → spawn the normal shell, then inject `hermes\r` so the
    // user SEES their own shell run the command (alias/shim resolve as if typed).
    const { url, procs } = await boot({
      resolveCliPreset: async (id) => {
        expect(id).toBe('hermes')
        return { command: 'hermes', label: 'Hermes CLI' }
      },
    })
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { cli: 'hermes' })
    await waitFor(c, 'terminal.ready')
    // The seeded command lands as input on the new pty (with a trailing CR).
    await new Promise((r) => setTimeout(r, 50))
    expect(procs[0]!.written).toContain('hermes\r')
  })

  it('does NOT seed a command for the raw shell preset (command: null)', async () => {
    const { url, procs } = await boot({
      resolveCliPreset: async () => ({ command: null, label: 'Raw shell' }),
    })
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { cli: 'shell' })
    await waitFor(c, 'terminal.ready')
    await new Promise((r) => setTimeout(r, 50))
    expect(procs[0]!.written).toHaveLength(0)
  })

  it('REJECTS an unavailable/unknown preset BEFORE spawning (honest, no shell)', async () => {
    const { url, procs } = await boot({
      resolveCliPreset: async (id) => {
        throw new Error(`CLI preset "${id}" is not available on this host.`)
      },
    })
    const c = connect(url)
    await waitFor(c, 'connect')
    const err = waitFor<{ message: string }>(c, 'terminal.error')
    c.emit('terminal.start', { cli: 'codex' })
    expect((await err).message).toMatch(/isn't installed|not installed|not available/i)
    // Never spawned a shell for an unavailable preset.
    expect(procs).toHaveLength(0)
  })

  it('ignores an unknown preset gracefully when no resolver is wired (raw shell)', async () => {
    // With no resolver injected and no `cli` field, start behaves exactly as today.
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')
    expect(procs).toHaveLength(1)
    expect(procs[0]!.written).toHaveLength(0)
  })
})

describe('/agent-deck-terminal handshake auth (C1, non-loopback bind)', () => {
  const auth = { required: true, token: 'TERM_TOKEN', autoGenerated: false }

  it('connects when the handshake carries the matching token', async () => {
    const { url } = await boot({ auth })
    const c = connect(url, { auth: { token: 'TERM_TOKEN' } })
    await expect(waitFor(c, 'connect')).resolves.toBeUndefined()
  })

  it('refuses the handshake with NO token', async () => {
    const { url } = await boot({ auth })
    const c = connect(url)
    await expect(
      Promise.race([
        waitFor<Error>(c, 'connect_error'),
        waitFor(c, 'connect').then(() => {
          throw new Error('should not have connected without a token')
        }),
      ]),
    ).resolves.toBeDefined()
  })

  it('refuses the handshake with a WRONG token', async () => {
    const { url } = await boot({ auth })
    const c = connect(url, { auth: { token: 'WRONG' } })
    await expect(
      Promise.race([
        waitFor<Error>(c, 'connect_error'),
        waitFor(c, 'connect').then(() => {
          throw new Error('should not have connected with a wrong token')
        }),
      ]),
    ).resolves.toBeDefined()
  })
})

describe('/agent-deck-terminal gating (terminal disabled)', () => {
  it('refuses EVERY connection when enabled=false', async () => {
    const { url } = await boot({ enabled: false })
    const c = connect(url)
    await expect(
      Promise.race([
        waitFor<Error>(c, 'connect_error'),
        waitFor(c, 'connect').then(() => {
          throw new Error('should not have connected when the terminal is disabled')
        }),
      ]),
    ).resolves.toBeDefined()
  })
})

describe('/agent-deck-terminal no-$HOME refusal', () => {
  it('emits a calm terminal.error when no workspace root resolves and $HOME is not allowed', async () => {
    // No roots + allowHome explicitly false → spawn refuses → calm error, no shell.
    const { url, procs } = await boot({ allowHome: false, roots: [] })
    const c = connect(url)
    await waitFor(c, 'connect')
    const err = waitFor<{ message: string }>(c, 'terminal.error')
    c.emit('terminal.start', {})
    expect((await err).message).toMatch(/unavailable/i)
    expect(procs).toHaveLength(0)
  })
})

describe('/agent-deck-terminal audit log', () => {
  it('emits structured start + stop audit events (pid, cwd, time) with no secrets', async () => {
    const events: TerminalAuditEvent[] = []
    const { url, procs } = await boot({ audit: (e) => events.push(e) })
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')

    expect(events).toHaveLength(1)
    expect(events[0]!.event).toBe('terminal.session.start')
    expect(events[0]!.pid).toBe(procs[0]!.pid)
    expect(typeof events[0]!.cwd).toBe('string')
    expect(events[0]!.cwd.length).toBeGreaterThan(0)
    expect(() => new Date(events[0]!.time).toISOString()).not.toThrow()
    // The audit record carries ONLY the safe fields — never shell I/O.
    expect(Object.keys(events[0]!).sort()).toEqual(['cwd', 'event', 'pid', 'time'])

    const exit = waitFor<{ exitCode: number }>(c, 'terminal.exit')
    procs[0]!.pushExit(0)
    await exit
    expect(events).toHaveLength(2)
    expect(events[1]!.event).toBe('terminal.session.stop')
    expect(events[1]!.pid).toBe(procs[0]!.pid)
    expect(events[1]!.exitCode).toBe(0)
  })

  it('emits a stop audit (exitCode null) on socket disconnect', async () => {
    const events: TerminalAuditEvent[] = []
    const { url } = await boot({ audit: (e) => events.push(e) })
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', {})
    await waitFor(c, 'terminal.ready')
    c.disconnect()
    await new Promise((r) => setTimeout(r, 100))
    expect(events.map((e) => e.event)).toEqual(['terminal.session.start', 'terminal.session.stop'])
    expect(events[1]!.exitCode).toBeNull()
  })
})

describe('/agent-deck-terminal park + reattach (refresh-survives, stable sessionId)', () => {
  it('PARKS the pty on disconnect when a stable sessionId was supplied (no immediate kill)', async () => {
    const { url, procs } = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { sessionId: 'sess-A' })
    await waitFor(c, 'terminal.ready')
    c.disconnect()
    // Grace window: the shell stays ALIVE so a refresh can resume it.
    await new Promise((r) => setTimeout(r, 100))
    expect(procs[0]!.killed).toBe(false)
  })

  it('REATTACHES to the SAME pty on reconnect with the same sessionId (no fresh spawn)', async () => {
    const { url, procs } = await boot()
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'sess-B' })
    const first = await waitFor<{ pid: number }>(c1, 'terminal.ready')
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 50))

    // A "refresh": a brand-new socket reattaches by the same stable sessionId.
    const c2 = connect(url)
    await waitFor(c2, 'connect')
    const ready = waitFor<{ pid: number; resumed?: boolean }>(c2, 'terminal.ready')
    c2.emit('terminal.start', { sessionId: 'sess-B' })
    const second = await ready
    // SAME shell: same pid, only one pty ever spawned, flagged as resumed.
    expect(second.pid).toBe(first.pid)
    expect(second.resumed).toBe(true)
    expect(procs).toHaveLength(1)
  })

  it('REPLAYS buffered scrollback produced while parked, on reattach', async () => {
    const { url, procs } = await boot()
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'sess-C' })
    await waitFor(c1, 'terminal.ready')
    // Output BEFORE the drop is buffered for replay.
    procs[0]!.pushData('before-drop\r\n')
    await waitFor<string>(c1, 'terminal.data')
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 30))
    // Output produced WHILE parked must also be buffered.
    procs[0]!.pushData('while-parked\r\n')

    const c2 = connect(url)
    await waitFor(c2, 'connect')
    // Collect the replayed bytes that arrive right after reattach.
    const chunks: string[] = []
    c2.on('terminal.data', (d: string) => chunks.push(d))
    c2.emit('terminal.start', { sessionId: 'sess-C' })
    await waitFor(c2, 'terminal.ready')
    await new Promise((r) => setTimeout(r, 50))
    const replayed = chunks.join('')
    expect(replayed).toContain('before-drop')
    expect(replayed).toContain('while-parked')
  })

  it('REAPS a parked session after the grace timeout (bounded survival)', async () => {
    // A tiny grace so the test is fast; after it elapses the parked pty is killed.
    const { url, procs } = await boot({ parkGraceMs: 40 })
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { sessionId: 'sess-D' })
    await waitFor(c, 'terminal.ready')
    c.disconnect()
    await new Promise((r) => setTimeout(r, 120))
    // The grace elapsed with no reattach → the shell was reaped (no orphan).
    expect(procs[0]!.killed).toBe(true)
  })

  it('bounds the replay buffer to the most recent bytes (max buffered)', async () => {
    const { url, procs } = await boot({ maxBufferBytes: 16 })
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'sess-E' })
    await waitFor(c1, 'terminal.ready')
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 20))
    // Far more than the cap → only the most-recent tail survives for replay.
    procs[0]!.pushData('0123456789')
    procs[0]!.pushData('ABCDEFGHIJ')

    const c2 = connect(url)
    await waitFor(c2, 'connect')
    const chunks: string[] = []
    c2.on('terminal.data', (d: string) => chunks.push(d))
    c2.emit('terminal.start', { sessionId: 'sess-E' })
    await waitFor(c2, 'terminal.ready')
    await new Promise((r) => setTimeout(r, 50))
    const replayed = chunks.join('')
    expect(replayed.length).toBeLessThanOrEqual(16)
    // The newest bytes are kept; the oldest are dropped.
    expect(replayed.endsWith('ABCDEFGHIJ')).toBe(true)
    expect(replayed).not.toContain('012345')
  })

  it('does NOT count a parked session against a freshly reconnecting same-id client (cap)', async () => {
    // cap of 1: a refresh of the SAME session must reattach, not be cap-rejected.
    const { url, procs } = await boot({ maxSessions: 1 })
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'sess-F' })
    await waitFor(c1, 'terminal.ready')
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 30))

    const c2 = connect(url)
    await waitFor(c2, 'connect')
    const ready = waitFor<{ pid: number }>(c2, 'terminal.ready')
    c2.emit('terminal.start', { sessionId: 'sess-F' })
    // Reattaches (same pid) rather than hitting the "too many" cap error.
    await expect(ready).resolves.toBeDefined()
    expect(procs).toHaveLength(1)
  })

  it('frees the parked slot when the parked shell EXITS on its own while parked', async () => {
    // A parked shell that exits (e.g. the user typed `exit` then the socket dropped)
    // must release its session slot so a fresh start under the same id spawns anew.
    const { url, procs } = await boot()
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'sess-G' })
    await waitFor(c1, 'terminal.ready')
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 30))
    // The parked shell exits on its own.
    procs[0]!.pushExit(0)
    await new Promise((r) => setTimeout(r, 20))

    const c2 = connect(url)
    await waitFor(c2, 'connect')
    const ready = waitFor<{ pid: number; resumed?: boolean }>(c2, 'terminal.ready')
    c2.emit('terminal.start', { sessionId: 'sess-G' })
    const r = await ready
    // No live parked pty to resume → a brand-new shell spawns (not resumed).
    expect(r.resumed).toBeFalsy()
    expect(procs).toHaveLength(2)
  })
})
