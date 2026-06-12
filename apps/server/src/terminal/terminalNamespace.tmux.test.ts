/**
 * tmux-backed terminal integration — REAL node-pty + a REAL (throwaway) tmux
 * server. Proves the persistence layer end to end: the shell survives pty
 * disposal AND a full server reboot (the BFF-restart simulation), foreign
 * sessions are attach-only, and the deck kill guard holds.
 *
 * The suite runs its own tmux server on a private `-L adk_test_*` socket, so it
 * never touches the user's default tmux server, and skips cleanly when tmux or
 * node-pty is unavailable on the host.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import type { Server as SocketIOServer } from 'socket.io'
import { attachTerminal, TERMINAL_NAMESPACE, type TerminalOptions } from './terminalNamespace'
import { loadNodePty } from './ptyBridge'
import { listTmuxSessions, hasTmuxSession, capturePane } from './tmux'

// This suite needs the REAL tmux path: make sure no other suite's disable flag
// (or the operator's) leaks in.
delete process.env.AGENT_DECK_DISABLE_TMUX

const run = promisify(execFile)
const hostHasTmux = await run('tmux', ['-V']).then(
  () => true,
  () => false,
)
const hostHasPty = !!(await loadNodePty())

/** Private throwaway tmux server for this suite (never the user's default). */
const SOCKET_NAME = `adk_test_ns_${process.pid}`
const SOCKET = ['-L', SOCKET_NAME]

async function killTestServer(): Promise<void> {
  try {
    await run('tmux', [...SOCKET, 'kill-server'])
  } catch {
    // no server running — already clean
  }
  // Remove the throwaway socket file too (tmux leaves it behind in
  // $TMUX_TMPDIR/tmux-$UID, defaulting to /tmp/tmux-$UID).
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  if (uid !== null) {
    rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${uid}`, SOCKET_NAME), { force: true })
  }
}

let workdir: string
let http: HttpServer | undefined
let io: SocketIOServer | undefined
const clients: ClientSocket[] = []

async function teardownServer(): Promise<void> {
  for (const c of clients.splice(0)) c.disconnect()
  await io?.close()
  io = undefined
  if (http) {
    const server = http
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  http = undefined
}

/** Boot the namespace with REAL node-pty + the throwaway tmux server. */
async function boot(options: TerminalOptions = {}): Promise<string> {
  http = createServer()
  io = attachTerminal(http, {
    roots: [workdir],
    tmuxSocketArgs: SOCKET,
    ...options,
  })
  await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
  const { port } = http!.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

function connect(url: string): ClientSocket {
  const c = ioClient(`${url}${TERMINAL_NAMESPACE}`, { transports: ['websocket'], forceNew: true })
  clients.push(c)
  return c
}

function waitFor<T = unknown>(socket: ClientSocket, event: string, ms = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms)
    socket.once(event, (payload: T) => {
      clearTimeout(t)
      resolve(payload)
    })
  })
}

/** Collect terminal.data on a socket and resolve once it contains `needle`. */
function waitForOutput(socket: ClientSocket, needle: string, ms = 8000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = ''
    const t = setTimeout(
      () => reject(new Error(`timeout waiting for output "${needle}"; got: ${buf.slice(-400)}`)),
      ms,
    )
    const onData = (d: string) => {
      buf += d
      if (buf.includes(needle)) {
        clearTimeout(t)
        socket.off('terminal.data', onData)
        resolve(buf)
      }
    }
    socket.on('terminal.data', onData)
  })
}

/**
 * Wait until a tmux client is actually ATTACHED to the session. Keystrokes sent
 * before the client finishes entering raw mode can be eaten by its pty line
 * discipline (a real user types after the prompt appears; tests must wait too).
 */
async function awaitAttached(name: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const sessions = await listTmuxSessions(SOCKET)
    if (sessions.some((s) => s.name === name && s.attachedCount > 0)) {
      await new Promise((r) => setTimeout(r, 120))
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timeout waiting for a client to attach to ${name}`)
}

describe.skipIf(!hostHasTmux || !hostHasPty)('tmux-backed terminal (real shell)', () => {
  beforeAll(async () => {
    await killTestServer()
    workdir = mkdtempSync(join(tmpdir(), 'adk-tmux-ns-'))
  })
  afterAll(async () => {
    await killTestServer()
    rmSync(workdir, { recursive: true, force: true })
  })
  afterEach(async () => {
    await teardownServer()
  })

  it('reattaches the SAME shell after pty disposal, and after a full server reboot', async () => {
    let url = await boot()
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'persist-1' })
    const r1 = await waitFor<{ pid: number; resumed?: boolean; persistent?: boolean }>(
      c1,
      'terminal.ready',
    )
    expect(r1.persistent).toBe(true)
    expect(r1.resumed).toBeFalsy()
    await awaitAttached('adk_persist-1')
    // Plant a marker IN THE SHELL's state (an env var survives only in the
    // same shell process).
    c1.emit('terminal.input', 'MARK=alive_7c3\r')
    c1.emit('terminal.input', 'echo SET:$MARK\r')
    await waitForOutput(c1, 'SET:alive_7c3')
    // The deck-owned session exists on the tmux server, namespaced adk_*.
    const listed = await listTmuxSessions(SOCKET)
    expect(listed.some((s) => s.name === 'adk_persist-1' && s.deckOwned)).toBe(true)

    // Disconnect: the server disposes the tmux CLIENT pty; the shell lives on.
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 150))
    await expect(hasTmuxSession('adk_persist-1', SOCKET)).resolves.toBe(true)

    // Reattach on a fresh socket: `-A` resumes the SAME shell (env var intact).
    const c2 = connect(url)
    await waitFor(c2, 'connect')
    c2.emit('terminal.start', { sessionId: 'persist-1' })
    const r2 = await waitFor<{ resumed?: boolean; persistent?: boolean }>(c2, 'terminal.ready')
    expect(r2.resumed).toBe(true)
    expect(r2.persistent).toBe(true)
    await awaitAttached('adk_persist-1')
    c2.emit('terminal.input', 'echo FIRST:$MARK\r')
    await waitForOutput(c2, 'FIRST:alive_7c3')

    // BFF RESTART: tear the WHOLE server down and boot a brand-new one. The
    // tmux server (a separate daemon) still holds the shell; the same stable id
    // reattaches with ZERO state carried across the restart.
    await teardownServer()
    url = await boot()
    const c3 = connect(url)
    await waitFor(c3, 'connect')
    c3.emit('terminal.start', { sessionId: 'persist-1' })
    const r3 = await waitFor<{ resumed?: boolean }>(c3, 'terminal.ready')
    expect(r3.resumed).toBe(true)
    await awaitAttached('adk_persist-1')
    c3.emit('terminal.input', 'echo REBOOT:$MARK\r')
    await waitForOutput(c3, 'REBOOT:alive_7c3')
  }, 30000)

  it('seeds the CLI preset command on creation but NOT again on a tmux resume', async () => {
    // The typed line shows the literal $((1+1)); only the OUTPUT contains
    // SEEDED__2, so counting that substring counts seed RUNS exactly.
    const url = await boot({
      resolveCliPreset: async () => ({ command: 'echo SEEDED__$((1+1))', label: 'probe' }),
    })
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'seed-1', cli: 'probe' })
    await waitFor(c1, 'terminal.ready')
    await waitForOutput(c1, 'SEEDED__2')
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 150))

    const c2 = connect(url)
    await waitFor(c2, 'connect')
    c2.emit('terminal.start', { sessionId: 'seed-1', cli: 'probe' })
    const r2 = await waitFor<{ resumed?: boolean }>(c2, 'terminal.ready')
    expect(r2.resumed).toBe(true)
    // Settle, then check the pane: the seed must have RUN exactly once.
    await awaitAttached('adk_seed-1')
    await new Promise((r) => setTimeout(r, 600))
    const pane = await capturePane('adk_seed-1', 500, SOCKET)
    expect(pane.split('SEEDED__2').length - 1).toBe(1)
  }, 20000)

  it('backfills recent scrollback, then a delimiter marker, on a deck reattach', async () => {
    const url = await boot()
    const c1 = connect(url)
    await waitFor(c1, 'connect')
    c1.emit('terminal.start', { sessionId: 'backfill-1' })
    const r1 = await waitFor<{ resumed?: boolean }>(c1, 'terminal.ready')
    expect(r1.resumed).toBeFalsy()
    await awaitAttached('adk_backfill-1')
    c1.emit('terminal.input', 'echo HISTORY_b1\r')
    await waitForOutput(c1, 'HISTORY_b1')
    c1.disconnect()
    await new Promise((r) => setTimeout(r, 150))

    // Reattach on a fresh socket. The server emits the captured history + the
    // marker BEFORE terminal.ready, so by the time ready arrives the backfill
    // is already in the buffer — and it precedes any live attach redraw.
    const c2 = connect(url)
    let buf = ''
    c2.on('terminal.data', (d: string) => {
      buf += d
    })
    await waitFor(c2, 'connect')
    c2.emit('terminal.start', { sessionId: 'backfill-1' })
    const r2 = await waitFor<{ resumed?: boolean }>(c2, 'terminal.ready')
    expect(r2.resumed).toBe(true)
    const marker = 'reattached, recent history above'
    expect(buf).toContain(marker)
    expect(buf).toContain('HISTORY_b1')
    // The history precedes the marker (history first, then the delimiter).
    expect(buf.indexOf('HISTORY_b1')).toBeLessThan(buf.indexOf(marker))
    // The marker is server-injected (never typed into the pane), so the live
    // redraw cannot repeat it: EXACTLY once. (The history's last screenful CAN
    // legitimately appear again when tmux repaints the live screen.)
    expect(buf.split(marker).length - 1).toBe(1)
  }, 20000)

  it('reports a DETACH honestly (exit event with detached:true, session survives)', async () => {
    const url = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { sessionId: 'detach-1' })
    await waitFor(c, 'terminal.ready')
    await awaitAttached('adk_detach-1')
    c.emit('terminal.input', 'echo READY_d1\r')
    await waitForOutput(c, 'READY_d1')
    const exit = waitFor<{ exitCode: number; detached?: boolean }>(c, 'terminal.exit')
    // The user detaches from INSIDE the session ($TMUX is set there).
    c.emit('terminal.input', 'tmux detach\r')
    const e = await exit
    expect(e.detached).toBe(true)
    // NOT a shell death: the session is still alive in the tmux server.
    await expect(hasTmuxSession('adk_detach-1', SOCKET)).resolves.toBe(true)
  }, 20000)

  it('reports a real shell EXIT as a death (no detached flag, session gone)', async () => {
    const url = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { sessionId: 'death-1' })
    await waitFor(c, 'terminal.ready')
    await awaitAttached('adk_death-1')
    c.emit('terminal.input', 'echo READY_x1\r')
    await waitForOutput(c, 'READY_x1')
    const exit = waitFor<{ exitCode: number; detached?: boolean }>(c, 'terminal.exit')
    c.emit('terminal.input', 'exit\r')
    const e = await exit
    expect(e.detached).toBeFalsy()
    await expect(hasTmuxSession('adk_death-1', SOCKET)).resolves.toBe(false)
  }, 20000)

  it('terminal.close on a deck-owned session KILLS it in the tmux server', async () => {
    const url = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { sessionId: 'close-1' })
    await waitFor(c, 'terminal.ready')
    await awaitAttached('adk_close-1')
    c.emit('terminal.input', 'echo READY_c1\r')
    await waitForOutput(c, 'READY_c1')
    await expect(hasTmuxSession('adk_close-1', SOCKET)).resolves.toBe(true)
    c.emit('terminal.close')
    // The explicit close ends the persistent session for real.
    let alive = true
    for (let i = 0; i < 40 && alive; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
      alive = await hasTmuxSession('adk_close-1', SOCKET)
    }
    expect(alive).toBe(false)
  }, 20000)

  it('attaches to a FOREIGN session, and close only DETACHES it (never kills)', async () => {
    // The "user's own" session, created outside the deck.
    await run('tmux', [...SOCKET, 'new-session', '-d', '-s', 'victors_own'])
    const url = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    c.emit('terminal.start', { attach: 'victors_own' })
    const r = await waitFor<{ persistent?: boolean; resumed?: boolean }>(c, 'terminal.ready')
    expect(r.persistent).toBe(true)
    // A foreign attach always joins a pre-existing shell: honestly a resume
    // (which also drives the scrollback backfill on the client).
    expect(r.resumed).toBe(true)
    await awaitAttached('victors_own')
    c.emit('terminal.input', 'echo FOREIGN_ok\r')
    await waitForOutput(c, 'FOREIGN_ok')
    // Close = detach for a foreign session; the user's session survives.
    c.emit('terminal.close')
    await new Promise((r2) => setTimeout(r2, 300))
    await expect(hasTmuxSession('victors_own', SOCKET)).resolves.toBe(true)
    // And the deck really was attached to THE user's session (shared state).
    const pane = await capturePane('victors_own', 200, SOCKET)
    expect(pane).toContain('FOREIGN_ok')
  }, 20000)

  it('REFUSES to attach to a nonexistent foreign session (never creates it)', async () => {
    const url = await boot()
    const c = connect(url)
    await waitFor(c, 'connect')
    const err = waitFor<{ message: string }>(c, 'terminal.error')
    c.emit('terminal.start', { attach: 'never_made' })
    expect((await err).message).toMatch(/does not exist/i)
    // Attach-only: the foreign name must NOT have been created.
    const listed = await listTmuxSessions(SOCKET)
    expect(listed.some((s) => s.name === 'never_made')).toBe(false)
  }, 20000)
})
