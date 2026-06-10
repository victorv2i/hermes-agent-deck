/**
 * `/chat-run` Socket.IO namespace handler — the chat BFF heart.
 *
 * Bridges the browser's durable, replay-tailable chat surface to the hermes
 * gateway's consume-once `/v1/runs` SSE. The run PUMP is owned by a server-scoped
 * {@link RunManager} (NOT by any socket), so a run survives a tab reload /
 * disconnect: the pump keeps draining the gateway SSE into the shared RunStore,
 * and a reconnecting client resumes from the full buffer.
 *
 *  - `run`             → startRun → append run.started → RunManager.start (pump)
 *                        → this socket SUBSCRIBES (replay-then-tail)
 *  - `resume`          → SUBSCRIBE: replay store.snapshot(after_cursor), then tail
 *  - `abort`           → run.stopping → RunManager.abort(pump) + gateway.stopRun
 *  - `approval.respond`→ respondApproval
 *  - `disconnect`      → ONLY unsubscribe this socket's tails; never abort a run
 *
 * Inbound commands are validated with the protocol zod schemas; bad input is
 * rejected (never forwarded to the gateway). Each server→client event is the
 * cursor-tagged ChatServerEvent, emitted under its own `event` name so the web
 * client gets the spec's named-event surface with monotonic cursors.
 */
import type { Namespace, Server, Socket } from 'socket.io'
import {
  RunCommand,
  ResumeCommand,
  AbortCommand,
  ApprovalRespondCommand,
  ChatServerEvent,
} from '@agent-deck/protocol'
import type { GatewayClientLike } from '../hermes/gatewayClient'
import { socketHandshakeOk, type AuthConfig } from '../auth/auth'
import { RunStore } from './runStore'
import { RunManager, mapGatewayEvent } from './runManager'

export const CHAT_NAMESPACE = '/chat-run'

const TERMINAL_EVENTS = new Set<ChatServerEvent['event']>([
  'run.completed',
  'run.failed',
  'run.cancelled',
])

export const MAX_TAILS_PER_SOCKET = 128

// Re-exported for callers/tests that still import it from here; the pump (and
// thus the mapping) is owned by the RunManager now.
export { mapGatewayEvent }

export interface ChatRunDeps {
  gateway: GatewayClientLike
  store?: RunStore
  /** Auth posture; when required, the handshake must carry a matching token.
   * Omitted/absent = no auth (loopback / tests). */
  auth?: AuthConfig
}

export function registerChatRunHandlers(io: Server, deps: ChatRunDeps): Namespace {
  // The run pump is SERVER-OWNED: one RunManager backs the whole namespace, so a
  // run is pumped to its terminal frame regardless of which sockets come and go.
  const runManager = new RunManager(deps.gateway, deps.store ?? new RunStore())
  const store = runManager.store
  const namespace = io.of(CHAT_NAMESPACE)

  // C1: gate the handshake on a non-loopback bind. The browser sends the token
  // as handshake `auth: { token }`; a missing/mismatched token is refused before
  // any chat command is wired. No-op when auth is not required (loopback/tests).
  if (deps.auth?.required) {
    const auth = deps.auth
    namespace.use((socket, next) => {
      if (socketHandshakeOk(auth, socket.handshake)) {
        next()
        return
      }
      next(new Error('unauthorized'))
    })
  }

  namespace.on('connection', (socket: Socket) => {
    // Replay/tail subscriptions this socket holds, so we can unsubscribe them on
    // disconnect. The RUN itself is owned by the RunManager, never by this socket.
    const tails = new Map<string, (e: ChatServerEvent) => void>()

    const emit = (event: ChatServerEvent): void => {
      socket.emit(event.event, event)
    }

    const dropTail = (runId: string, expected?: (e: ChatServerEvent) => void): void => {
      const cb = tails.get(runId)
      if (expected && cb !== expected) return
      if (!cb) return
      store.unsubscribe(runId, cb)
      tails.delete(runId)
    }

    /** Subscribe this socket to a run: replay the buffered snapshot after
     * `afterCursor`, then tail live appends — gated so replay + tail never
     * overlap. Shared by `run` (issuing socket) and `resume` (reconnect). This
     * body is synchronous: no append can interleave between the snapshot and the
     * subscribe (appends only happen from the RunManager pump's async loop), so
     * replay-then-subscribe preserves order and loses nothing. */
    const subscribe = (runId: string, afterCursor: number): void => {
      dropTail(runId)

      const replayed = store.snapshot(runId, afterCursor)
      let maxReplayedCursor = afterCursor
      for (const event of replayed) {
        maxReplayedCursor = Math.max(maxReplayedCursor, event.cursor ?? 0)
        emit(event)
      }
      // Tail live appends only if the run is still open, GATED so we forward only
      // events strictly newer than the last replayed cursor. Cursor-LESS frames
      // are transient broadcasts (run.heartbeat) — pure liveness signals outside
      // the replay log — and are always forwarded.
      if (!store.isDone(runId)) {
        const cb = (event: ChatServerEvent): void => {
          if (event.cursor === undefined || event.cursor > maxReplayedCursor) emit(event)
          if (TERMINAL_EVENTS.has(event.event)) {
            dropTail(runId, cb)
          }
        }
        tails.set(runId, cb)
        store.subscribe(runId, cb)
        while (tails.size > MAX_TAILS_PER_SOCKET) {
          const oldestRunId = tails.keys().next().value
          if (typeof oldestRunId !== 'string') break
          dropTail(oldestRunId)
        }
      }
    }

    socket.on('run', async (payload: unknown) => {
      const cmd = RunCommand.safeParse(payload)
      if (!cmd.success) {
        socket.emit('command.error', { command: 'run', message: 'invalid run command' })
        return
      }
      let runId: string
      try {
        const started = await deps.gateway.startRun({
          input: cmd.data.input,
          model: cmd.data.model,
          sessionId: cmd.data.session_id,
          ...(cmd.data.attachments ? { attachments: cmd.data.attachments } : {}),
          // Prior turns ride every run: the gateway does NOT load history for a
          // bare session_id, so without this the agent is amnesiac per-turn.
          ...(cmd.data.conversation_history
            ? { conversationHistory: cmd.data.conversation_history }
            : {}),
        })
        runId = started.runId
      } catch (err) {
        socket.emit('command.error', {
          command: 'run',
          message: err instanceof Error ? err.message : 'startRun failed',
        })
        return
      }

      // Resolve the DURABLE hermes session id. A resumed chat already carries it
      // (cmd.data.session_id); a NEW chat starts session-less, so ask the gateway
      // which session it derived (GET /v1/runs/{id}) — best-effort, undefined if
      // it can't be learned. Surfacing it on run.started is what lets the client
      // route to /chat/:id and rehydrate the transcript after a browser refresh.
      let sessionId: string | undefined = cmd.data.session_id
      if (!sessionId) {
        const resolved = await deps.gateway.getRunSession(runId)
        sessionId = resolved.sessionId ?? undefined
      }

      // Synthesize run.started into the store (cursor 1) so a reconnecting client
      // replays it too.
      store.append(runId, {
        event: 'run.started',
        run_id: runId,
        session_id: sessionId,
        model: cmd.data.model,
        input: cmd.data.input,
      })
      // Launch the SERVER-OWNED pump, then subscribe the issuing socket the same
      // way a reconnect does (replay-then-tail). The pump now outlives this
      // socket, so a reload/disconnect cannot stop the run.
      runManager.start(runId, sessionId)
      subscribe(runId, 0)
    })

    socket.on('resume', (payload: unknown) => {
      const cmd = ResumeCommand.safeParse(payload)
      if (!cmd.success) {
        socket.emit('command.error', { command: 'resume', message: 'invalid resume command' })
        return
      }
      const runId = cmd.data.run_id
      // Guard: if this runId has never been seen by this server instance (no
      // events, not done, no active pump), the client is resuming a stale or
      // migrated run that will never arrive. Emit command.error so the client
      // can surface an honest "run not found" state rather than hanging forever
      // waiting for events that never come (the 120s reaper is the last resort,
      // but we can surface the error immediately here).
      if (!store.has(runId) && !runManager.isActive(runId)) {
        socket.emit('command.error', {
          command: 'resume',
          message: `run ${runId} not found on this server`,
        })
        return
      }
      subscribe(runId, cmd.data.after_cursor ?? 0)
    })

    socket.on('abort', async (payload: unknown) => {
      const cmd = AbortCommand.safeParse(payload)
      if (!cmd.success) {
        socket.emit('command.error', { command: 'abort', message: 'invalid abort command' })
        return
      }
      const runId = cmd.data.run_id
      // Surface stopping to the client immediately so the UI reacts without
      // waiting on the gateway. (The gateway's own run.cancelled still flows if
      // it arrives.) run.stopping is not buffered into the replay log — it's a
      // transient status, and the real terminal frame is what the store records.
      emit({ event: 'run.stopping', run_id: runId })
      // Abort the server-owned pump so the BFF stops holding the SSE open even if
      // the gateway is slow to cancel. This is an EXPLICIT stop — distinct from a
      // socket disconnect, which must NOT abort the run.
      runManager.abort(runId)
      try {
        await deps.gateway.stopRun(runId)
      } catch (err) {
        socket.emit('command.error', {
          command: 'abort',
          message: err instanceof Error ? err.message : 'stopRun failed',
        })
      }
    })

    socket.on('approval.respond', async (payload: unknown) => {
      const cmd = ApprovalRespondCommand.safeParse(payload)
      if (!cmd.success) {
        socket.emit('command.error', {
          command: 'approval.respond',
          message: 'invalid approval command',
        })
        return
      }
      try {
        await deps.gateway.respondApproval(cmd.data.run_id, cmd.data.approval_id, cmd.data.choice)
      } catch (err) {
        socket.emit('command.error', {
          command: 'approval.respond',
          message: err instanceof Error ? err.message : 'respondApproval failed',
        })
      }
    })

    socket.on('disconnect', () => {
      // ONLY drop this socket's replay/tail subscriptions. The run pump is
      // server-owned (RunManager): a disconnect must NOT abort it, so the run
      // keeps streaming into the store and a reconnecting client resumes it.
      for (const runId of tails.keys()) dropTail(runId)
      tails.clear()
    })
  })

  return namespace
}
