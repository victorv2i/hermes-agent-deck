/**
 * `/kanban` Socket.IO namespace — live board updates.
 *
 * Wire protocol (names + shapes defined in packages/protocol/src/kanban.ts):
 *   client → server:
 *     'kanban.subscribe'  { board? }            start receiving snapshots for a board
 *   server → client:
 *     'kanban.snapshot'   KanbanBoardResponse   a fresh board (on subscribe, and on
 *                                               every upstream cursor advance)
 *     'kanban.error'      { message }            a transient upstream error (UI calm)
 *
 * LIVENESS — why a poller, not a raw-WS relay:
 *   hermes's kanban plugin exposes a `/events` WebSocket, but bridging it from Node
 *   needs a raw WS client dependency this BFF deliberately does not carry, and the
 *   plugin already exposes a monotonic `latest_event_id` cursor on every `/board`
 *   read. So the namespace runs ONE server-owned poller per distinct board: it
 *   re-fetches the board through the shared {@link KanbanClient} every
 *   {@link KanbanNamespaceOptions.pollIntervalMs} (~4s default) and emits a
 *   `kanban.snapshot` only when the cursor changes (or on a socket's first
 *   subscribe), so an idle board stays quiet. A raw-WS relay (sub-second pushes) is
 *   the documented fast-follow; the poller is the portable, hermetic, dependency-free
 *   floor and the wire contract (`kanban.snapshot`) won't change when it lands.
 *
 * SECURITY / LIFECYCLE — mirrors the terminal/chat namespaces:
 *   - Loopback / Tailscale origins only (handshake middleware), defense-in-depth.
 *   - Token-gated handshake on a non-loopback bind (no-op on loopback / tests).
 *   - One poller per board, ref-counted by subscribers; the timer is cleared when the
 *     last subscriber for a board disconnects, and all timers on namespace close.
 */
import type { Namespace, Server, Socket } from 'socket.io'
import { KANBAN_NAMESPACE, KanbanSubscribeCommand } from '@agent-deck/protocol'
import type { KanbanBoardResponse } from '@agent-deck/protocol'
import { socketHandshakeOk, type AuthConfig } from '../auth/auth'
import { isLoopbackOrigin } from '../terminal/terminalNamespace'
import type { KanbanClient } from './kanbanClient'

export { KANBAN_NAMESPACE }

/** Default board-poll cadence. ~4s balances freshness against upstream load. */
export const DEFAULT_POLL_INTERVAL_MS = 4_000

/** A minimal timer surface so tests can inject a fake clock (no real intervals). */
export interface KanbanTimer {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

const realTimer: KanbanTimer = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

export interface KanbanNamespaceOptions {
  kanbanClient: Pick<KanbanClient, 'board'>
  /** Poll cadence in ms. Default {@link DEFAULT_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number
  /** Origin allowlist predicate; defaults to loopback / localhost / *.ts.net. */
  isAllowedOrigin?: (origin: string) => boolean
  /** Auth posture; when required, the handshake must carry a matching token. */
  auth?: AuthConfig
  /** Injectable timer (tests). Defaults to real setInterval/clearInterval. */
  timer?: KanbanTimer
}

/** Server-owned poller for ONE board slug, shared by every subscriber of that board. */
interface BoardPoller {
  /** Sockets currently watching this board. */
  readonly room: string
  /** Last cursor we emitted, so we only push on change. -1 = nothing emitted yet. */
  lastCursor: number
  /** Subscriber count; the timer stops when this hits 0. */
  refs: number
  handle: unknown
  /** A poll is in flight — skip overlapping ticks (slow upstream). */
  inFlight: boolean
}

/** The room name a board's subscribers share (used to broadcast snapshots). */
function boardRoom(board: string): string {
  return `kanban:${board}`
}

/**
 * Register the `/kanban` namespace on an existing Socket.IO server. Returns the
 * namespace. Exposed separately from any attach helper so it can co-mount on the
 * shared `io` alongside `/chat-run` and `/agent-deck-terminal`.
 */
export function registerKanbanHandlers(io: Server, options: KanbanNamespaceOptions): Namespace {
  const client = options.kanbanClient
  const allowed = options.isAllowedOrigin ?? isLoopbackOrigin
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timer = options.timer ?? realTimer
  const namespace = io.of(KANBAN_NAMESPACE)

  /** Live pollers keyed by board slug. */
  const pollers = new Map<string, BoardPoller>()

  // Defense-in-depth: refuse non-loopback origins at the handshake. A missing Origin
  // (same-origin / non-browser) is allowed, matching the HTTP CORS rule.
  namespace.use((socket, next) => {
    const origin = socket.handshake.headers.origin
    if (!origin || allowed(origin)) {
      next()
      return
    }
    next(new Error('forbidden origin'))
  })

  // Gate the handshake on a non-loopback bind. No-op when auth is not required.
  if (options.auth?.required) {
    const auth = options.auth
    namespace.use((socket, next) => {
      if (socketHandshakeOk(auth, socket.handshake)) {
        next()
        return
      }
      next(new Error('unauthorized'))
    })
  }

  /** Fetch the board once; broadcast a snapshot to the room when the cursor moved. */
  const poll = async (board: string, force: boolean): Promise<void> => {
    const poller = pollers.get(board)
    if (!poller || poller.inFlight) return
    poller.inFlight = true
    let res: KanbanBoardResponse
    try {
      res = await client.board(board)
    } catch {
      // Transient upstream error — keep the poller alive and stay calm. A degraded
      // hermes (plugin absent) is NOT an error: the client returns available:false.
      namespace.to(poller.room).emit('kanban.error', { message: 'Kanban update failed' })
      poller.inFlight = false
      return
    }
    poller.inFlight = false
    // available:false has no cursor — emit it once (on force) so the UI can render the
    // honest empty state, then stay quiet until subscribers change.
    const cursor = res.available ? res.data.cursor : -1
    if (force || cursor !== poller.lastCursor) {
      poller.lastCursor = cursor
      namespace.to(poller.room).emit('kanban.snapshot', res)
    }
  }

  /** Ensure a poller exists for `board`, bump its ref count, return it. */
  const acquire = (board: string): BoardPoller => {
    let poller = pollers.get(board)
    if (!poller) {
      poller = { room: boardRoom(board), lastCursor: -1, refs: 0, handle: null, inFlight: false }
      poller.handle = timer.setInterval(() => {
        void poll(board, false)
      }, interval)
      pollers.set(board, poller)
    }
    poller.refs += 1
    return poller
  }

  /** Drop a ref on `board`'s poller; tear it down when the last subscriber leaves. */
  const release = (board: string): void => {
    const poller = pollers.get(board)
    if (!poller) return
    poller.refs -= 1
    if (poller.refs <= 0) {
      timer.clearInterval(poller.handle)
      pollers.delete(board)
    }
  }

  namespace.on('connection', (socket: Socket) => {
    /** Boards this socket is subscribed to (it can switch; we clean up on disconnect). */
    const subscribed = new Set<string>()

    socket.on('kanban.subscribe', async (payload: unknown) => {
      const parsed = KanbanSubscribeCommand.safeParse(payload ?? {})
      if (!parsed.success) {
        socket.emit('kanban.error', { message: 'invalid subscribe command' })
        return
      }
      const board = parsed.data.board ?? 'default'
      if (subscribed.has(board)) {
        // Already watching — just re-send the current board so a re-subscribe is a
        // cheap refresh. Fetch directly so this socket gets an immediate snapshot.
        try {
          const res = await client.board(board)
          socket.emit('kanban.snapshot', res)
        } catch {
          socket.emit('kanban.error', { message: 'Kanban update failed' })
        }
        return
      }
      subscribed.add(board)
      await socket.join(boardRoom(board))
      acquire(board)
      // Immediate first snapshot for THIS socket (don't wait a full poll interval).
      try {
        const res = await client.board(board)
        socket.emit('kanban.snapshot', res)
        // Seed the shared poller's cursor so the next tick only pushes real changes.
        const poller = pollers.get(board)
        if (poller && res.available) poller.lastCursor = res.data.cursor
      } catch {
        socket.emit('kanban.error', { message: 'Kanban update failed' })
      }
    })

    socket.on('disconnect', () => {
      for (const board of subscribed) release(board)
      subscribed.clear()
    })
  })

  // Clear every poll timer when the namespace's server closes.
  io.engine.on('close', () => {
    for (const poller of pollers.values()) timer.clearInterval(poller.handle)
    pollers.clear()
  })

  return namespace
}
