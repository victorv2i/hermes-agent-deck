/**
 * Typed `socket.io-client` for the BFF's `/agent-deck-terminal` namespace.
 *
 * The BFF owns the PTY (the hermes dashboard exposes no terminal route), so this
 * is a thin, framing-only client: it forwards keystrokes/resizes up and hands
 * shell bytes / lifecycle frames to callbacks. xterm.js does the rendering; this
 * module never touches the DOM, so it is unit-testable with a fake transport.
 *
 * Wire protocol (mirrors apps/server/src/terminal/terminalNamespace.ts):
 *   up:   'terminal.start' {cols,rows,cwd?,sessionId?,attach?} · 'terminal.input' string ·
 *         'terminal.resize' {cols,rows} · 'terminal.close'
 *   down: 'terminal.ready' {pid,resumed?,persistent?} · 'terminal.data' string ·
 *         'terminal.exit' {exitCode,detached?} · 'terminal.error' {message}
 */
import { io, type Socket } from 'socket.io-client'
import { socketAuth } from '@/lib/authToken'

export const TERMINAL_NAMESPACE = '/agent-deck-terminal'

/** Minimal socket surface this module needs — enough to stub in tests. The real
 * `Socket` from socket.io-client satisfies it. */
export interface TerminalSocketLike {
  connected: boolean
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener?: (...args: unknown[]) => void): unknown
  emit(event: string, ...args: unknown[]): unknown
  connect?(): unknown
  disconnect(): unknown
}

export type TerminalStatus =
  | 'connecting'
  | 'connected'
  | 'exited'
  | 'error'
  | 'disconnected'
  | 'dropped'

export interface TerminalSocketCallbacks {
  /** Shell output (stdout+stderr) — write straight to xterm. */
  onData: (data: string) => void
  /** Shell spawned; carries the child pid and whether the session is
   * tmux-backed (persistent: it survives deck restarts and disconnects). */
  onReady?: (info: { pid: number; persistent: boolean }) => void
  /** Shell exited; carries the exit code. */
  onExit?: (info: { exitCode: number }) => void
  /** Could not start / backend unavailable — show calmly, do not retry-loop. */
  onError?: (info: { message: string }) => void
  /** Connection lifecycle for a header/status affordance. */
  onStatusChange?: (status: TerminalStatus) => void
  /**
   * The transport reconnected AFTER an established session dropped, and this
   * session has NO stable id to reattach to — so the server force-killed the pty
   * on disconnect and the old shell (scrollback + processes) is GONE. A fresh
   * `terminal.start` would silently swap in a brand-new shell that LOOKS like the
   * same session, so we surface this for an explicit restart instead. (When a
   * stable `sessionId` IS present the server parks + reattaches, so this never
   * fires — the same shell resumes and {@link onResumed} fires instead.)
   */
  onReconnectDropped?: () => void
  /**
   * The server REATTACHED to the parked shell for our stable `sessionId` (a
   * refresh or a reconnect resumed the SAME shell). Buffered scrollback has been
   * replayed as `terminal.data` just before this. Honest UI: no "dropped" overlay.
   */
  onResumed?: () => void
}

export interface TerminalSocketOptions {
  /** Inject a transport for tests; defaults to a real same-origin connection. */
  socket?: TerminalSocketLike
  /** Override the namespace URL (defaults to same-origin namespace). */
  url?: string
}

/** Build the default same-origin transport. Vite proxies `/socket.io` to the
 * BFF in dev; in prod the app is served by (or behind) the BFF. */
function defaultSocket(url?: string): Socket {
  // C1 (auth): pass the locally saved token as handshake `auth { token }` when
  // present; on loopback `socketAuth()` is undefined → nothing sent.
  return io(url ?? TERMINAL_NAMESPACE, { autoConnect: false, auth: socketAuth() })
}

interface StartArgs {
  cols: number
  rows: number
  cwd?: string
  /** Optional launcher preset id — the server seeds its command into the shell. */
  cli?: string
  /**
   * Stable, client-supplied session id. When set, the server PARKS this shell on
   * disconnect and REATTACHES (replaying buffered scrollback) on a later start
   * with the same id — so a browser refresh (or a connect from another machine)
   * resumes the SAME shell instead of silently swapping in a fresh one.
   */
  sessionId?: string
  /**
   * A FOREIGN tmux session name to attach to (one the user created in their own
   * tmux). Attach-only: the server never creates or kills it. Mutually
   * exclusive with `sessionId`.
   */
  attach?: string
}

/**
 * Drives one terminal session over the namespace. Lifecycle:
 *   const t = new TerminalSocket(cbs); t.connect(); t.start({cols,rows});
 *   t.input('ls\r'); t.resize(120, 40); … t.dispose()
 * `start` is sent ONCE, on the first connect. A later reconnect does NOT silently
 * re-open a fresh shell: the server force-kills the pty on disconnect, so the old
 * shell is gone — re-`start`ing would mislead the user into thinking the same
 * session resumed. Instead we surface a 'dropped' status so they can explicitly
 * restart (a deliberate fresh shell) — honesty over a silent swap.
 */
export class TerminalSocket {
  private readonly socket: TerminalSocketLike
  private readonly callbacks: TerminalSocketCallbacks
  private pendingStart: StartArgs | null = null
  private startSent = false
  private disposed = false
  /** True once the transport has connected at least once (so a later 'connect'
   * is a RECONNECT — the old pty was force-killed and the shell is lost). */
  private everConnected = false
  /** The visibility/pageshow reconnect handler, kept for removal on dispose. */
  private readonly onVisible = (): void => {
    // VISIBILITY-DRIVEN RECONNECT: a phone returning from hours in the
    // background should not wait out socket.io's backoff — the moment the page
    // is visible again, dial immediately. Only after a first successful connect
    // (a never-connected socket is still doing its own initial dial), and only
    // while actually disconnected. The 'connect' handler below then re-starts
    // any reattachable session (stable id or foreign attach), so shells
    // reattach within a couple of seconds of coming back.
    if (this.disposed || !this.everConnected || this.socket.connected) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    this.callbacks.onStatusChange?.('connecting')
    this.socket.connect?.()
  }

  constructor(callbacks: TerminalSocketCallbacks, options: TerminalSocketOptions = {}) {
    this.callbacks = callbacks
    this.socket = options.socket ?? defaultSocket(options.url)
    this.wire()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible)
    }
    if (typeof window !== 'undefined') {
      // pageshow also fires on bfcache restores, where no visibilitychange does.
      window.addEventListener('pageshow', this.onVisible)
    }
  }

  private wire(): void {
    this.socket.on('connect', () => {
      // A RECONNECT (we'd connected before). Two honest outcomes:
      //  - With a stable `sessionId` (or a foreign `attach` target), the shell
      //    outlived the drop on the server side, so we re-`start` with the same
      //    id/name to REATTACH — the same shell resumes and its scrollback
      //    replays. (`terminal.ready {resumed:true}` → onResumed, no 'dropped'
      //    overlay.)
      //  - Without one, the server force-killed the pty, so the prior shell is
      //    gone. We do NOT silently swap in a brand-new shell that masquerades as
      //    the same session — surface 'dropped' for an explicit restart instead.
      if (this.everConnected) {
        if (this.pendingStart?.sessionId || this.pendingStart?.attach) {
          this.callbacks.onStatusChange?.('connecting')
          this.startSent = false
          this.flushStart()
          return
        }
        this.callbacks.onStatusChange?.('dropped')
        this.callbacks.onReconnectDropped?.()
        return
      }
      this.everConnected = true
      this.callbacks.onStatusChange?.('connected')
      // Open the shell once the FIRST transport is live.
      this.flushStart()
    })
    this.socket.on('disconnect', () => {
      if (this.disposed) return
      this.callbacks.onStatusChange?.('disconnected')
    })
    this.socket.on('connect_error', () => {
      this.callbacks.onStatusChange?.('error')
    })
    this.socket.on('terminal.data', (payload: unknown) => {
      if (typeof payload === 'string') this.callbacks.onData(payload)
    })
    this.socket.on('terminal.ready', (payload: unknown) => {
      const pid = readNumber(payload, 'pid')
      if (pid !== null) {
        this.callbacks.onReady?.({ pid, persistent: readBool(payload, 'persistent') })
      }
      // A reattach to the parked shell: the same session resumed (buffered
      // scrollback already replayed). Mark connected + notify, so no "dropped"
      // overlay is shown for an honest resume.
      if (readBool(payload, 'resumed')) {
        this.callbacks.onStatusChange?.('connected')
        this.callbacks.onResumed?.()
      }
    })
    this.socket.on('terminal.exit', (payload: unknown) => {
      const exitCode = readNumber(payload, 'exitCode') ?? 0
      this.callbacks.onStatusChange?.('exited')
      this.callbacks.onExit?.({ exitCode })
    })
    this.socket.on('terminal.error', (payload: unknown) => {
      const message = readString(payload, 'message') ?? 'Terminal error.'
      this.callbacks.onStatusChange?.('error')
      this.callbacks.onError?.({ message })
    })
  }

  /** Open the connection (no-op if a pre-connected socket was injected). */
  connect(): void {
    this.callbacks.onStatusChange?.('connecting')
    if (this.socket.connected) {
      // Pre-connected (test/injected) socket: emit start immediately. Mark it as
      // connected so a later reconnect is still detected (and 'dropped' surfaces).
      this.everConnected = true
      this.flushStart()
    } else {
      this.socket.connect?.()
    }
  }

  /** Request a shell with the given geometry. Buffered until connected. */
  start(args: StartArgs): void {
    this.pendingStart = args
    this.flushStart()
  }

  private flushStart(): void {
    if (this.disposed || this.startSent || !this.pendingStart) return
    if (!this.socket.connected) return
    this.socket.emit('terminal.start', this.pendingStart)
    this.startSent = true
  }

  /** Forward keystrokes / paste to the shell. */
  input(data: string): void {
    if (this.disposed) return
    this.socket.emit('terminal.input', data)
  }

  /** Forward a resize to the pty. */
  resize(cols: number, rows: number): void {
    if (this.disposed) return
    this.socket.emit('terminal.resize', { cols, rows })
  }

  /**
   * Explicitly END the session on the server ('terminal.close'): a deck-owned
   * tmux session is killed for real, a foreign one is merely detached, a plain
   * shell is killed. The caller still disposes this socket afterwards.
   */
  close(): void {
    if (this.disposed) return
    this.socket.emit('terminal.close')
  }

  /** Tear down: stop emitting and close the transport (the BFF kills the pty). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisible)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pageshow', this.onVisible)
    }
    this.socket.disconnect()
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readNumber(value: unknown, key: string): number | null {
  const rec = asRecord(value)
  const n = rec?.[key]
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function readString(value: unknown, key: string): string | null {
  const rec = asRecord(value)
  const s = rec?.[key]
  return typeof s === 'string' ? s : null
}

function readBool(value: unknown, key: string): boolean {
  const rec = asRecord(value)
  return rec?.[key] === true
}
