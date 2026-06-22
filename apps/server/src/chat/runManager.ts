/**
 * Server-owned run lifecycle (P0.1 — the runtime-truth fix).
 *
 * The hermes gateway's `/v1/runs` SSE is consume-once; the {@link RunStore} is
 * the durable, replay-tailable buffer the browser reconnects against. For that
 * durability to be real, the pump that drains the gateway SSE into the store
 * MUST outlive any single browser socket. Previously the pump lived inside the
 * `/chat-run` connection handler, so a tab reload / disconnect aborted it and
 * the run stopped being tailed — durability in name only.
 *
 * The RunManager owns the shared RunStore plus one {@link AbortController} per
 * in-flight pump. It is created ONCE at server scope (in
 * {@link registerChatRunHandlers}), not per socket, so a run is pumped to its
 * terminal frame regardless of socket churn. Sockets merely subscribe to the
 * store (replay-then-tail); they never own the pump.
 *
 * ROBUSTNESS (the socket-less-pump guard): a pump that outlives every socket is
 * the whole point, but it also means a pump wedged on a stalled gateway SSE
 * could linger forever, holding a slot and leaving its run non-terminal so a
 * reconnecting client auto-resumes a run that never completes. Two guards close
 * that gap:
 *   - a MAX-CONCURRENT-PUMPS cap, so a flood of runs can't spawn unbounded pumps;
 *   - an IDLE REAPER that synthesizes `run.failed` for a pump that sees NO new
 *     activity for a generous window. "Activity" is ANY SSE signal — a mapped or
 *     unmapped gateway frame OR a keepalive heartbeat — so a legitimately long
 *     "thinking" agent (which the gateway keeps alive with keepalives) is NEVER
 *     killed; only a truly silent, wedged stream is.
 * Both reactions make the run terminal, which schedules its store eviction, so
 * non-terminal stale runs don't accumulate.
 */
import { ChatServerEvent } from '@agent-deck/protocol'
import type { GatewayClientLike, GatewayEvent } from '../hermes/gatewayClient'
import { RunStore } from './runStore'

/**
 * Terminal-event name suffixes: any gateway event whose name ends with one of
 * these should close the run, even if the exact event type is not in the current
 * protocol vocabulary (future Hermes version bump). This prevents the idle reaper
 * from being the only thing that terminates a run after a 120s wait.
 */
const TERMINAL_SUFFIXES = ['.completed', '.failed', '.cancelled'] as const

/** Map a raw gateway SSE event to a validated ChatServerEvent, stamping the
 * BFF-known session_id when available. Returns null for frames outside the
 * protocol vocabulary (e.g. anything the gateway should not forward).
 *
 * CATCH-ALL: if the event name is not recognized but ends with a known terminal
 * suffix (.completed / .failed / .cancelled), we synthesize a `run.failed` frame
 * (the safest terminal: the run is over, but we don't know how). This prevents a
 * future Hermes version from hanging a run for 120s when it emits a new terminal
 * event type the current BFF doesn't know about yet. */
export function mapGatewayEvent(
  raw: GatewayEvent,
  ctx: { runId: string; sessionId?: string },
): ChatServerEvent | null {
  const candidate: Record<string, unknown> = {
    ...raw,
    run_id: typeof raw.run_id === 'string' ? raw.run_id : ctx.runId,
  }
  if (ctx.sessionId && candidate.session_id === undefined) {
    candidate.session_id = ctx.sessionId
  }
  const parsed = ChatServerEvent.safeParse(candidate)
  if (parsed.success) return parsed.data

  // The event is outside the known protocol vocabulary. If its name ends with a
  // terminal suffix, synthesize run.failed so the run reaches a terminal state
  // immediately rather than waiting for the 120s idle reaper.
  const eventName = typeof raw.event === 'string' ? raw.event : ''
  if (TERMINAL_SUFFIXES.some((s) => eventName.endsWith(s))) {
    const fallback: ChatServerEvent = {
      event: 'run.failed',
      run_id: ctx.runId,
      error: `unrecognized terminal event: ${eventName}`,
      ...(ctx.sessionId ? { session_id: ctx.sessionId } : {}),
    }
    return fallback
  }
  return null
}

/** Tuning for the pump-robustness guards. All optional; sane defaults below. */
export interface RunManagerOptions {
  /**
   * Hard cap on simultaneously-active pumps. A `start()` beyond this does not
   * launch a pump; instead it makes the run terminal (run.failed) so the client
   * never hangs. Default 64 — far above any realistic concurrent-run count for a
   * single-user control room, while still bounding a pathological flood.
   */
  maxConcurrentPumps?: number
  /**
   * How long a pump may see NO activity (no frame AND no keepalive) before the
   * reaper declares it wedged and synthesizes run.failed. Generous on purpose:
   * the gateway emits keepalives during long agent thinking, each of which is
   * activity, so this only fires on a genuinely silent/stalled stream. Default
   * 120s.
   */
  idleTimeoutMs?: number
  /** How often the reaper sweeps active pumps. Default 10s. */
  reaperIntervalMs?: number
  /** Injected clock (tests). Defaults to Date.now. */
  now?: () => number
  /**
   * Notified when a run's approval gate opens (`pending`) or closes (`cleared`)
   * — when the pump observes an `approval.request`, an `approval.responded`, or a
   * terminal frame. The chat namespace uses this to BROADCAST the change to every
   * connected device (cross-device approval push), independent of which run a
   * given socket is tailing. Optional; a fire-and-forget side channel.
   */
  onApprovalChange?: (change: ApprovalChange) => void
}

/** An approval-gate transition for a run (see {@link RunManagerOptions.onApprovalChange}). */
export type ApprovalChange =
  | {
      kind: 'pending'
      runId: string
      sessionId?: string
      command?: string
      description?: string
    }
  | { kind: 'cleared'; runId: string }

const DEFAULT_MAX_CONCURRENT_PUMPS = 64
const DEFAULT_IDLE_TIMEOUT_MS = 120_000
const DEFAULT_REAPER_INTERVAL_MS = 10_000

/** Per-pump bookkeeping the reaper consults. */
interface PumpState {
  abort: AbortController
  /** Timestamp (via the injected clock) of the last observed SSE activity —
   * any frame or keepalive. The reaper compares `now - lastActivityAt`. */
  lastActivityAt: number
  /** The gateway this run lives on. A run is PINNED to the gateway it started on
   * (the active profile at start time), so a mid-run profile switch never moves
   * its pump/stop/approval to a different gateway. Defaults to the manager's
   * default gateway when `start` is called without an explicit one. */
  gateway: GatewayClientLike
}

/**
 * Owns the run-pump lifecycle at server scope. One instance backs the whole
 * `/chat-run` namespace; its {@link RunStore} is the durable event log every
 * socket replays/tails.
 */
export class RunManager {
  /** The shared, durable event log. Sockets subscribe to it; the pump appends. */
  readonly store: RunStore
  /** The default gateway, used when `start` is called without a per-run one (back-
   * compat) and as the fallback for {@link gatewayFor} once a pump has finished. */
  private readonly gateway: GatewayClientLike
  /** Per-pump state (abort handle + last-activity clock + pinned gateway). */
  private readonly pumps = new Map<string, PumpState>()

  private readonly maxConcurrentPumps: number
  private readonly idleTimeoutMs: number
  private readonly reaperIntervalMs: number
  private readonly now: () => number
  private readonly onApprovalChange?: (change: ApprovalChange) => void
  /** Runs we have broadcast a still-OPEN approval for, so we clear exactly once
   * (on the resolving frame or the terminal frame, whichever comes first). */
  private readonly approvalOpen = new Set<string>()
  /** The single sweeping interval; only runs while ≥1 pump is active. */
  private reaperTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    gateway: GatewayClientLike,
    store: RunStore = new RunStore(),
    options: RunManagerOptions = {},
  ) {
    this.gateway = gateway
    this.store = store
    this.maxConcurrentPumps = options.maxConcurrentPumps ?? DEFAULT_MAX_CONCURRENT_PUMPS
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.reaperIntervalMs = options.reaperIntervalMs ?? DEFAULT_REAPER_INTERVAL_MS
    this.now = options.now ?? Date.now
    this.onApprovalChange = options.onApprovalChange
  }

  /** Broadcast an approval gate OPENING for a run (idempotent per open gate). */
  private signalApprovalPending(
    runId: string,
    info: Extract<ChatServerEvent, { event: 'approval.request' }>,
  ): void {
    if (!this.onApprovalChange) return
    this.approvalOpen.add(runId)
    const sessionId = typeof info.session_id === 'string' ? info.session_id : undefined
    this.onApprovalChange({
      kind: 'pending',
      runId,
      ...(sessionId ? { sessionId } : {}),
      ...(info.command ? { command: info.command } : {}),
      ...(info.description ? { description: info.description } : {}),
    })
  }

  /** Broadcast an approval gate CLOSING for a run — only if one was open, so a
   * routine terminal frame for a run that never had an approval is silent. */
  private signalApprovalCleared(runId: string): void {
    if (!this.onApprovalChange) return
    if (!this.approvalOpen.delete(runId)) return
    this.onApprovalChange({ kind: 'cleared', runId })
  }

  /** True while a server-owned pump is actively draining this run's SSE. */
  isActive(runId: string): boolean {
    return this.pumps.has(runId)
  }

  /**
   * The gateway a run is PINNED to (the one its pump started on). Falls back to
   * the default gateway only when no pump is active — callers must therefore gate
   * on {@link isActive} before routing a Stop/approval, since a terminal run has
   * nothing to act on and the fallback could otherwise reach the wrong agent
   * after a profile switch.
   */
  gatewayFor(runId: string): GatewayClientLike {
    return this.pumps.get(runId)?.gateway ?? this.gateway
  }

  /**
   * Optimistically broadcast that a run's approval gate has CLOSED — called right
   * after a successful `respondApproval` so a cross-device "needs approval" badge
   * clears immediately, instead of waiting on the gateway to echo an
   * `approval.responded` SSE frame (which it normally does, but the cross-device
   * push must not hinge on that echo). Idempotent: a later echoed responded/terminal
   * frame finds the gate already closed and is a no-op.
   */
  clearApproval(runId: string): void {
    this.signalApprovalCleared(runId)
  }

  /**
   * Launch ONE gateway streamRun pump for this run, independent of any socket.
   * It maps + appends each frame into the store, runs to a terminal frame (or
   * synthesizes run.failed on abnormal close), and cleans itself up on finish.
   * Idempotent: a second start for an already-pumping run is a no-op.
   *
   * Over the concurrency cap, NO pump is launched; the run is made terminal
   * (run.failed) so the issuing client gets a definite outcome instead of hanging.
   *
   * `gateway` pins this run to a specific gateway (the active profile's, resolved
   * by the caller at start time). Omitted → the manager's default gateway.
   */
  start(runId: string, sessionId?: string, gateway?: GatewayClientLike): void {
    if (this.pumps.has(runId)) return
    if (this.pumps.size >= this.maxConcurrentPumps) {
      // Don't add a pump we can't watch; fail the run deterministically.
      if (!this.store.isDone(runId)) {
        this.store.append(runId, {
          event: 'run.failed',
          run_id: runId,
          error: 'server is at its concurrent-run capacity; please retry',
        })
      }
      return
    }
    const abort = new AbortController()
    const pinned = gateway ?? this.gateway
    this.pumps.set(runId, { abort, lastActivityAt: this.now(), gateway: pinned })
    this.ensureReaper()
    void this.pump(runId, sessionId, abort.signal, pinned)
  }

  /** Mark fresh activity for a pump (any frame or keepalive resets its clock). */
  private touch(runId: string): void {
    const state = this.pumps.get(runId)
    if (state) state.lastActivityAt = this.now()
  }

  /** Start the sweeping interval if it isn't already running. */
  private ensureReaper(): void {
    if (this.reaperTimer) return
    this.reaperTimer = setInterval(() => this.sweep(), this.reaperIntervalMs)
    // Never keep the process alive purely to sweep pumps.
    this.reaperTimer.unref?.()
  }

  /** Stop sweeping once nothing is left to watch (no leaked interval). */
  private maybeStopReaper(): void {
    if (this.pumps.size === 0 && this.reaperTimer) {
      clearInterval(this.reaperTimer)
      this.reaperTimer = null
    }
  }

  /**
   * One reaper pass: any pump idle past the window is wedged — make its run
   * terminal (run.failed, if not already done) and abort it. Aborting unblocks
   * the pump's `for await`, whose finally removes it from the map; we also clear
   * the entry here so a second sweep doesn't re-fire on the same wedged pump.
   */
  private sweep(): void {
    const now = this.now()
    for (const [runId, state] of this.pumps) {
      if (now - state.lastActivityAt <= this.idleTimeoutMs) continue
      if (!this.store.isDone(runId)) {
        this.store.append(runId, {
          event: 'run.failed',
          run_id: runId,
          error: 'run stalled: no gateway activity within the idle window',
        })
      }
      state.abort.abort()
      this.pumps.delete(runId)
    }
    this.maybeStopReaper()
  }

  /**
   * Abort this run's pump (e.g. on an explicit user Stop) and make the run
   * DETERMINISTICALLY TERMINAL.
   *
   * Aborting the pump's AbortController tears down the gateway SSE `fetch`. With
   * the REAL gateway that fetch-abort THROWS (AbortError), so the pump's
   * `for await` rejects and its abort early-return (`if (signal.aborted) return`)
   * short-circuits BEFORE any terminal frame is appended — and the gateway's own
   * `run.cancelled` would have arrived on the very connection we just tore down,
   * so it is never consumed. The store would stay non-terminal forever: the
   * client hangs in `runStatus: 'stopping'` and a reload auto-resumes a run that
   * never completes. (The in-process mock hid this by gracefully yielding
   * run.cancelled before returning; real fetch-abort does not.)
   *
   * So we synthesize the terminal frame here: after aborting, if the store is not
   * already done, append `run.cancelled` ourselves. Subscribers + the store then
   * reach a terminal state regardless of whether the gateway's cancelled frame
   * ever arrives, and the client reducer resets `runStatus` to idle. The pump's
   * own abort early-return stays as-is (guarded by isDone, so no double-append).
   *
   * No-op if inactive (no pump). chatRun.ts still calls `gateway.stopRun`
   * afterward (best-effort) to actually cancel the gateway-side run.
   */
  abort(runId: string): void {
    const pump = this.pumps.get(runId)
    if (!pump) return
    pump.abort.abort()
    if (!this.store.isDone(runId)) {
      this.store.append(runId, { event: 'run.cancelled', run_id: runId })
    }
    // Mirror sweep(): drop the entry now so a same-run restart isn't swallowed by
    // start()'s idempotency guard during the window before the aborted iterator
    // reaches its finally. The pump's own finally delete is idempotent.
    this.pumps.delete(runId)
    this.maybeStopReaper()
  }

  private async pump(
    runId: string,
    sessionId: string | undefined,
    signal: AbortSignal,
    gateway: GatewayClientLike,
  ): Promise<void> {
    try {
      // A keepalive is liveness too: thread an onHeartbeat that resets the idle
      // clock so a long-thinking agent (silent except for gateway keepalives) is
      // never reaped. It is ALSO forwarded to subscribers as a transient
      // run.heartbeat (broadcast, never buffered/cursored) so the client can
      // honestly show "still alive, just quiet" instead of dead air.
      const onHeartbeat = (): void => {
        this.touch(runId)
        this.store.broadcast(runId, {
          event: 'run.heartbeat',
          run_id: runId,
          ...(sessionId ? { session_id: sessionId } : {}),
        })
      }
      for await (const raw of gateway.streamRun(runId, signal, onHeartbeat)) {
        // ANY frame — even one outside the protocol vocabulary that we drop —
        // proves the stream is alive, so reset the clock before mapping.
        this.touch(runId)
        const mapped = mapGatewayEvent(raw, { runId, sessionId })
        if (!mapped) continue
        // Heartbeats are NEVER buffered/cursored, whatever their source. The
        // BFF synthesizes its own from SSE keepalives (onHeartbeat above), but
        // if a gateway ever sent a DATA frame named run.heartbeat it would
        // parse cleanly and be cursored into the replay log without this guard.
        // Broadcast-only, same as the synthesized path.
        if (mapped.event === 'run.heartbeat') {
          this.store.broadcast(runId, mapped)
          continue
        }
        // Cross-device approval push: announce the gate opening/closing to the
        // whole namespace (the store.append below still drives the per-run tail).
        if (mapped.event === 'approval.request') this.signalApprovalPending(runId, mapped)
        else if (mapped.event === 'approval.responded') this.signalApprovalCleared(runId)
        this.store.append(runId, mapped)
      }
      // Stream ended. Only a terminal frame (run.completed/failed/cancelled)
      // counts as a clean finish. An abnormal close WITHOUT one is a failure —
      // never report it as success.
      if (signal.aborted) return
      if (!this.store.isDone(runId)) {
        this.store.append(runId, {
          event: 'run.failed',
          run_id: runId,
          error: 'stream closed before completion',
        })
      }
    } catch (err) {
      if (signal.aborted) return
      this.store.append(runId, {
        event: 'run.failed',
        run_id: runId,
        error: err instanceof Error ? err.message : 'stream error',
      })
    } finally {
      // The pump is finished (terminal frame, failure, or abort) — stop tracking
      // it. start() is idempotent while a pump is registered, so the entry we
      // delete is always our own. (A reaper sweep may have already deleted it;
      // delete is idempotent.) Stop the sweeper if this was the last pump.
      this.pumps.delete(runId)
      // Clear any still-open approval broadcast for this run (idempotent): a run
      // that ends — completed, cancelled, reaped, or errored — without an explicit
      // approval.responded must still clear its cross-device "needs approval" badge.
      this.signalApprovalCleared(runId)
      this.maybeStopReaper()
    }
  }
}
