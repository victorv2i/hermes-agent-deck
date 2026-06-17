/**
 * Typed `socket.io-client` for the BFF's durable `/chat-run` surface.
 *
 * Responsibilities:
 *  - Emit the four protocol commands: `run`, `resume`, `abort`,
 *    `approval.respond` (validated against the protocol zod schemas before the
 *    wire — never send malformed commands).
 *  - Subscribe to every named ChatServerEvent the BFF emits, validate each
 *    inbound frame with the discriminated-union schema, track the highest
 *    `cursor` seen (`lastCursor`), then hand the parsed event to a sink (the
 *    chat store's `ingest`).
 *  - Durable replay-tail: on (re)connect, if a run is still in flight,
 *    auto-`resume({ run_id, after_cursor: lastCursor })` so the BFF replays only
 *    what we missed and then tails live. The store's cursor de-dup makes any
 *    overlap idempotent.
 *
 * The transport is injected (a minimal {@link SocketLike}) so this module is
 * unit-testable with a fake socket and never needs a live gateway.
 */
import { io, type Socket } from 'socket.io-client'
import {
  ChatServerEvent,
  RunCommand,
  ResumeCommand,
  AbortCommand,
  ApprovalRespondCommand,
  ApprovalPendingBroadcast,
  ApprovalClearedBroadcast,
  APPROVAL_PENDING_EVENT,
  APPROVAL_CLEARED_EVENT,
} from '@agent-deck/protocol'
import { socketAuth } from './authToken'

export const CHAT_NAMESPACE = '/chat-run'

/** sessionStorage key holding the in-flight run so a full page reload can
 * reconnect and resume it (cleared on terminal events / fresh runs). */
export const ACTIVE_RUN_STORAGE_KEY = 'agent-deck:active-run'

/** What we persist to survive a reload: just enough to resume the tail. */
export interface PersistedActiveRun {
  runId: string
  lastCursor: number
}

/** Minimal Web Storage surface (sessionStorage) so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Default storage: real sessionStorage when available (browser), else null so
 * non-DOM contexts (SSR, some tests) silently no-op. */
function defaultStorage(): StorageLike | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage
  } catch {
    // Accessing sessionStorage can throw in sandboxed/iframe contexts.
  }
  return null
}

/** Read the persisted in-flight run, if any (shape-validated). */
export function readPersistedRun(
  storage: StorageLike | null = defaultStorage(),
): PersistedActiveRun | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(ACTIVE_RUN_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as PersistedActiveRun).runId === 'string' &&
      typeof (parsed as PersistedActiveRun).lastCursor === 'number'
    ) {
      return {
        runId: (parsed as PersistedActiveRun).runId,
        lastCursor: (parsed as PersistedActiveRun).lastCursor,
      }
    }
  } catch {
    // Malformed JSON or storage error — treat as no persisted run.
  }
  return null
}

/** Persist (or clear, when `run` is null) the in-flight run. Never throws. */
export function writePersistedRun(
  run: PersistedActiveRun | null,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    if (run) storage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(run))
    else storage.removeItem(ACTIVE_RUN_STORAGE_KEY)
  } catch {
    // Quota / disabled storage — persistence is best-effort.
  }
}

/** The named events the BFF emits, in protocol order. We subscribe to each so
 * the client mirrors the server's named-event surface. */
export const SERVER_EVENT_NAMES = [
  'run.started',
  'message.started',
  'message.delta',
  'reasoning.available',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'approval.request',
  'approval.responded',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.stopping',
  'run.heartbeat',
] as const satisfies readonly ChatServerEvent['event'][]

/** Reported when the BFF rejects a command (its own validation). */
export interface CommandError {
  command: string
  message: string
}

/** Reported when the connection terminates in a way the user can't recover from
 * by waiting (server-forced close, or the manager gave up reconnecting). A
 * transient drop does NOT produce one — see {@link ChatSocket}'s disconnect
 * classification. Carries the socket.io disconnect `reason` for context. */
export interface ConnectionError {
  reason: string
}

/** The only manager (socket.io's `socket.io`) lifecycle events this module
 * listens to. Naming them explicitly (rather than a bare `string`) keeps the
 * real strongly-typed `Manager` structurally assignable to {@link ManagerLike}. */
export type ManagerEvent = 'reconnect_attempt' | 'reconnect_failed'

/** Minimal manager surface (socket.io's `socket.io`) — the reconnect lifecycle
 * events fire here, not on the socket. The real `Manager` satisfies it. */
export interface ManagerLike {
  on(event: ManagerEvent, listener: (...args: unknown[]) => void): unknown
  off(event: ManagerEvent, listener?: (...args: unknown[]) => void): unknown
}

/** Minimal surface of a socket.io client this module depends on — enough to
 * stub in tests. The real `Socket` from socket.io-client satisfies it. */
export interface SocketLike {
  connected: boolean
  /**
   * socket.io's `socket.active`: true while the manager intends to
   * auto-reconnect (a transient drop), false once the link is terminally closed
   * (server-forced, or our own `disconnect()`). Used to classify a `disconnect`.
   * Optional so older stubs still satisfy the type; absent is treated as not
   * auto-reconnecting (safe: a missing flag escalates to terminal).
   */
  active?: boolean
  /** socket.io's manager handle, where reconnect_* events fire. Optional so a
   * minimal stub need not provide it. */
  io?: ManagerLike
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener?: (...args: unknown[]) => void): unknown
  emit(event: string, ...args: unknown[]): unknown
  connect?(): unknown
  disconnect(): unknown
}

export interface ChatSocketCallbacks {
  /** Called once per validated ChatServerEvent (cursor-tagged) in arrival order. */
  onEvent: (event: ChatServerEvent) => void
  /** Optional: connection lifecycle for a header status dot. */
  onStatusChange?: (status: ConnectionStatus) => void
  /** Optional: surface a BFF-side command rejection. */
  onCommandError?: (error: CommandError) => void
  /**
   * Optional: a genuinely terminal disconnect (server-forced close, or the
   * manager exhausted its reconnect attempts). A transient drop never calls
   * this — it stays a calm `'reconnecting'` status while the replay-tail
   * recovers. Use this to surface a visible error to the user.
   */
  onConnectionError?: (error: ConnectionError) => void
  /**
   * Optional: a NAMESPACE-wide approval broadcast — ANY run (not just the one
   * this socket tails) opened an approval gate. Cross-device push: a device that
   * never started/resumed the run still learns instantly that an agent is
   * waiting. Outside the per-run cursored stream entirely.
   */
  onApprovalPending?: (info: ApprovalPendingBroadcast) => void
  /** Optional: the matching close — a broadcast run's gate resolved or its run
   * ended (so a cross-device "needs approval" badge can clear). */
  onApprovalCleared?: (info: ApprovalClearedBroadcast) => void
}

/**
 * Connection lifecycle, classified so a transient drop reads as recovery, not
 * failure:
 *  - `connecting`    — first dial in progress.
 *  - `connected`     — live.
 *  - `reconnecting`  — a transient drop (socket.io will auto-reconnect); the
 *                      replay-tail will resume. Calm, no error.
 *  - `disconnected`  — terminal: the link is closed and won't self-heal.
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface ChatSocketOptions {
  /** Inject a transport for tests; defaults to a real connection to the BFF. */
  socket?: SocketLike
  /** Override the namespace URL (defaults to same-origin `/chat-run`). */
  url?: string
  /**
   * Storage for the in-flight run so a full page reload can resume it. Defaults
   * to sessionStorage in the browser. Pass `null` to disable persistence; pass a
   * fake to unit-test it. When a non-terminal run is found at construction time,
   * the client adopts it so the first `connect` auto-resumes it (a full replay
   * from cursor 0 — the reload lost the in-memory transcript).
   */
  storage?: StorageLike | null
}

/** Build the default same-origin transport. Vite proxies `/socket.io` to the
 * BFF in dev; in prod the app is served by (or behind) the BFF. */
function defaultSocket(url?: string): Socket {
  // `io(namespace)` with a leading slash connects to that namespace on the
  // current origin. `autoConnect: false` lets the caller decide when to dial.
  // C1 (auth): pass the locally saved token as handshake `auth { token }` when
  // present; on loopback `socketAuth()` is undefined, so nothing is sent.
  return io(url ?? CHAT_NAMESPACE, { autoConnect: false, auth: socketAuth() })
}

export class ChatSocket {
  private readonly socket: SocketLike
  private readonly callbacks: ChatSocketCallbacks
  /** Highest cursor applied; the resume anchor after a reconnect. */
  private cursor = 0
  /** The run we're currently driving/tailing, if any. */
  private activeRunId: string | null = null
  /** Whether the active run has reached a terminal frame (don't resume it). */
  private activeRunDone = false
  private disposed = false
  /** Where the in-flight run is persisted for reload-resume (may be null). */
  private readonly storage: StorageLike | null

  constructor(callbacks: ChatSocketCallbacks, options: ChatSocketOptions = {}) {
    this.callbacks = callbacks
    this.socket = options.socket ?? defaultSocket(options.url)
    this.storage = options.storage === undefined ? defaultStorage() : options.storage
    // Reload-resume: adopt a persisted in-flight run so the first `connect`
    // auto-emits a resume and the run survives a full page reload. (Terminal
    // runs are cleared from storage, so none is found.) Resume from cursor 0,
    // NOT the persisted lastCursor: the reload threw away every in-memory frame
    // (the streamed transcript, the run status, any pending approval), so that
    // cursor marks what the DEAD page had seen, not what this page has. A
    // partial replay would rebuild nothing before it — an empty transcript and,
    // worse, a silently lost still-pending approval. The full replay rebuilds
    // the whole live conversation; the BFF replay is cursor-tagged so it stays
    // idempotent. (While the page is ALIVE, in-place transport reconnects still
    // resume from the live `this.cursor`, as before.)
    const persisted = readPersistedRun(this.storage)
    if (persisted) {
      this.activeRunId = persisted.runId
      this.cursor = 0
      this.activeRunDone = false
    }
    this.wire()
  }

  get lastCursor(): number {
    return this.cursor
  }

  get runId(): string | null {
    return this.activeRunId
  }

  /** Open the connection (no-op if a pre-connected socket was injected). */
  connect(): void {
    this.callbacks.onStatusChange?.('connecting')
    this.socket.connect?.()
  }

  // --- commands -------------------------------------------------------------

  /** Start a run. Resets cursor tracking for the new run. Returns false (and
   * does not emit) if the command is invalid. */
  run(cmd: RunCommand): boolean {
    const parsed = RunCommand.safeParse(cmd)
    if (!parsed.success) return false
    // A new run starts a fresh cursor sequence (the BFF numbers per run).
    this.cursor = 0
    this.activeRunId = null
    this.activeRunDone = false
    // Drop any stale persisted run; the new run is re-persisted once its
    // run.started frame assigns an id.
    writePersistedRun(null, this.storage)
    this.socket.emit('run', parsed.data)
    return true
  }

  /** Explicitly resume a run from a cursor (the reconnect path calls this for
   * you; exposed for completeness). */
  resume(cmd: ResumeCommand): boolean {
    const parsed = ResumeCommand.safeParse(cmd)
    if (!parsed.success) return false
    this.activeRunId = parsed.data.run_id
    this.activeRunDone = false
    if (typeof parsed.data.after_cursor === 'number') this.cursor = parsed.data.after_cursor
    this.socket.emit('resume', parsed.data)
    return true
  }

  abort(cmd: AbortCommand): boolean {
    const parsed = AbortCommand.safeParse(cmd)
    if (!parsed.success) return false
    this.socket.emit('abort', parsed.data)
    return true
  }

  respondApproval(cmd: ApprovalRespondCommand): boolean {
    const parsed = ApprovalRespondCommand.safeParse(cmd)
    if (!parsed.success) return false
    this.socket.emit('approval.respond', parsed.data)
    return true
  }

  /** Tear down all listeners and disconnect. */
  dispose(): void {
    this.disposed = true
    for (const name of SERVER_EVENT_NAMES) this.socket.off(name)
    this.socket.off(APPROVAL_PENDING_EVENT)
    this.socket.off(APPROVAL_CLEARED_EVENT)
    this.socket.off('connect')
    this.socket.off('disconnect')
    this.socket.off('command.error')
    this.socket.io?.off('reconnect_attempt')
    this.socket.io?.off('reconnect_failed')
    this.socket.disconnect()
  }

  // --- wiring ---------------------------------------------------------------

  private wire(): void {
    this.socket.on('connect', () => {
      this.callbacks.onStatusChange?.('connected')
      // Durable replay-tail: if we were mid-run when the link dropped, ask the
      // BFF to replay everything after the last cursor we applied, then tail.
      if (this.activeRunId && !this.activeRunDone) {
        this.socket.emit('resume', { run_id: this.activeRunId, after_cursor: this.cursor })
      }
    })

    this.socket.on('disconnect', (...args: unknown[]) => {
      // Our own dispose() also triggers a 'disconnect' (reason 'io client
      // disconnect'); that's deliberate teardown, never a user-facing failure.
      if (this.disposed) return
      const reason = typeof args[0] === 'string' ? args[0] : 'disconnected'
      // Classify: socket.io's `socket.active` is true while the manager intends
      // to auto-reconnect (network blip, server restart, transport close, ping
      // timeout). That is transient — show a calm reconnecting state and let the
      // replay-then-tail resume on the next 'connect'. Only a link that won't
      // self-heal (server-forced close, or `active` absent) is terminal and
      // surfaces an error.
      if (this.socket.active) {
        this.callbacks.onStatusChange?.('reconnecting')
      } else {
        this.terminate(reason)
      }
    })

    // Manager reconnect lifecycle (fires on `socket.io`, not the socket):
    //  - reconnect_attempt: re-affirm the calm reconnecting state (no flapping).
    //  - reconnect_failed:  the manager gave up — escalate to a terminal error.
    // (A successful 'reconnect' is followed by the socket's own 'connect', which
    // already restores 'connected' and drives the replay-tail above.)
    this.socket.io?.on('reconnect_attempt', () => {
      if (!this.disposed) this.callbacks.onStatusChange?.('reconnecting')
    })
    this.socket.io?.on('reconnect_failed', () => {
      if (!this.disposed) this.terminate('reconnect failed')
    })

    this.socket.on('command.error', (...args: unknown[]) => {
      const payload = args[0]
      if (isCommandError(payload)) this.callbacks.onCommandError?.(payload)
    })

    for (const name of SERVER_EVENT_NAMES) {
      this.socket.on(name, (...args: unknown[]) => this.handleFrame(args[0]))
    }

    // Namespace-wide approval broadcasts (cross-device push) — validated, then
    // forwarded raw. They are NOT cursored run frames, so they bypass handleFrame
    // and never touch the resume anchor or active-run tracking.
    this.socket.on(APPROVAL_PENDING_EVENT, (...args: unknown[]) => {
      const parsed = ApprovalPendingBroadcast.safeParse(args[0])
      if (parsed.success) this.callbacks.onApprovalPending?.(parsed.data)
    })
    this.socket.on(APPROVAL_CLEARED_EVENT, (...args: unknown[]) => {
      const parsed = ApprovalClearedBroadcast.safeParse(args[0])
      if (parsed.success) this.callbacks.onApprovalCleared?.(parsed.data)
    })
  }

  /** A terminal disconnect: report offline AND raise a recoverable-only-by-
   * action error. Kept idempotent-friendly (callers guard on `disposed`). */
  private terminate(reason: string): void {
    this.callbacks.onStatusChange?.('disconnected')
    this.callbacks.onConnectionError?.({ reason })
  }

  /** Validate, track cursor + active-run state, then forward one frame. */
  private handleFrame(payload: unknown): void {
    const parsed = ChatServerEvent.safeParse(payload)
    if (!parsed.success) return
    const event = parsed.data

    // Track which run we're tailing so a reconnect resumes the right one.
    if (event.event === 'run.started') {
      this.activeRunId = event.run_id
      this.activeRunDone = false
    } else if (this.activeRunId === null) {
      // First frame after a fresh resume into an unknown run: adopt its id.
      this.activeRunId = event.run_id
    }

    // Advance the resume anchor only for cursored frames, and only forward.
    if (typeof event.cursor === 'number' && event.cursor <= this.cursor) {
      // Already-seen on this client (e.g. resume overlap). Drop it pre-store so
      // the resume anchor never regresses; the store de-dups too (defense in depth).
      return
    }
    if (typeof event.cursor === 'number') this.cursor = event.cursor

    const terminal =
      event.event === 'run.completed' ||
      event.event === 'run.failed' ||
      event.event === 'run.cancelled'
    if (terminal) this.activeRunDone = true

    // Reload-resume persistence: keep the {runId, lastCursor} fresh while the
    // run is in flight, and clear it the moment the run reaches a terminal
    // frame so a later reload won't try to resume a finished run.
    if (terminal) {
      writePersistedRun(null, this.storage)
    } else if (this.activeRunId) {
      writePersistedRun({ runId: this.activeRunId, lastCursor: this.cursor }, this.storage)
    }

    this.callbacks.onEvent(event)
  }
}

function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { command?: unknown }).command === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}
