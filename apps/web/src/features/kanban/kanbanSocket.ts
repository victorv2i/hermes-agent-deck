/**
 * Typed `socket.io-client` for the BFF's live `/kanban` namespace — the channel
 * that makes the board feel "connected to your agent". The server owns a
 * cursor-diff poller per board (it watches the upstream plugin's monotonic
 * `latest_event_id` and pushes a fresh snapshot only when it advances), so an
 * idle board is quiet and a moving board updates in ~seconds.
 *
 * This is a thin, framing-only client: it subscribes a board and validates each
 * inbound `kanban.snapshot` against the protocol envelope before handing it to a
 * callback. It never touches the DOM or the query cache (the hook
 * {@link useKanbanLive} wires it into TanStack Query), so it is unit-testable
 * with a fake transport.
 *
 * Wire protocol (mirrors apps/server/src/kanban/kanbanNamespace.ts):
 *   up:   'kanban.subscribe' {board?}
 *   down: 'kanban.snapshot' KanbanBoardResponse · 'kanban.error' {message}
 */
import { io, type Socket } from 'socket.io-client'
import { KANBAN_NAMESPACE, KanbanBoardResponse } from '@agent-deck/protocol'
import { socketAuth } from '@/lib/authToken'

/** Minimal socket surface this module needs — enough to stub in tests. The real
 * `Socket` from socket.io-client satisfies it. */
export interface KanbanSocketLike {
  connected: boolean
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener?: (...args: unknown[]) => void): unknown
  emit(event: string, ...args: unknown[]): unknown
  connect?(): unknown
  disconnect(): unknown
}

export type KanbanLiveStatus = 'connecting' | 'connected' | 'disconnected'

export interface KanbanSocketCallbacks {
  /** A fresh board snapshot (the availability envelope) — push it to the cache. */
  onSnapshot: (snapshot: KanbanBoardResponse) => void
  /** A transient upstream error — keep the UI calm (the last snapshot stands). */
  onError?: (info: { message: string }) => void
  /** Connection lifecycle for a header "live" dot. */
  onStatusChange?: (status: KanbanLiveStatus) => void
}

export interface KanbanSocketOptions {
  /** Inject a transport for tests; defaults to a real same-origin connection. */
  socket?: KanbanSocketLike
  /** Override the namespace URL (defaults to same-origin `/kanban`). */
  url?: string
}

/** Build the default same-origin transport. Vite proxies `/socket.io` to the
 * BFF in dev; in prod the app is served by (or behind) the BFF. */
function defaultSocket(url?: string): Socket {
  // C1 (auth): pass the locally saved token as handshake `auth { token }` when
  // present; on loopback `socketAuth()` is undefined → nothing sent.
  return io(url ?? KANBAN_NAMESPACE, { autoConnect: false, auth: socketAuth() })
}

/**
 * Drives one live board subscription. Lifecycle:
 *   const k = new KanbanSocket(cbs); k.connect(); k.subscribe('my-board');
 *   … k.dispose()
 * The current board is re-subscribed on (re)connect so a dropped link recovers
 * to a live tail deterministically.
 */
export class KanbanSocket {
  private readonly socket: KanbanSocketLike
  private readonly callbacks: KanbanSocketCallbacks
  /** The board we're watching (undefined → the active board). */
  private board: string | undefined
  /** Whether a subscribe has been requested (so reconnect re-subscribes). */
  private subscribed = false
  private disposed = false

  constructor(callbacks: KanbanSocketCallbacks, options: KanbanSocketOptions = {}) {
    this.callbacks = callbacks
    this.socket = options.socket ?? defaultSocket(options.url)
    this.wire()
  }

  private wire(): void {
    this.socket.on('connect', () => {
      this.callbacks.onStatusChange?.('connected')
      // Re-subscribe the current board so a reconnect lands back on a live tail.
      if (this.subscribed) this.emitSubscribe()
    })
    this.socket.on('disconnect', () => {
      if (this.disposed) return
      this.callbacks.onStatusChange?.('disconnected')
    })
    this.socket.on('connect_error', () => {
      this.callbacks.onStatusChange?.('disconnected')
    })
    this.socket.on('kanban.snapshot', (payload: unknown) => {
      const parsed = KanbanBoardResponse.safeParse(payload)
      if (parsed.success) this.callbacks.onSnapshot(parsed.data)
    })
    this.socket.on('kanban.error', (payload: unknown) => {
      const message = readMessage(payload)
      this.callbacks.onError?.({ message })
    })
  }

  /** Open the connection (no-op if a pre-connected socket was injected). */
  connect(): void {
    this.callbacks.onStatusChange?.('connecting')
    if (this.socket.connected) {
      if (this.subscribed) this.emitSubscribe()
    } else {
      this.socket.connect?.()
    }
  }

  /** Watch a board (omit `board` for the active board). Re-subscribing to a new
   * board switches the live tail. Buffered until connected. */
  subscribe(board?: string): void {
    this.board = board
    this.subscribed = true
    if (this.socket.connected) this.emitSubscribe()
  }

  private emitSubscribe(): void {
    if (this.disposed) return
    this.socket.emit('kanban.subscribe', this.board ? { board: this.board } : {})
  }

  /** Tear down: stop emitting and close the transport (the BFF drops the poller). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.socket.disconnect()
  }
}

function readMessage(value: unknown): string {
  if (value && typeof value === 'object') {
    const m = (value as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return 'Live board update failed.'
}
