/**
 * In-memory, cursor-indexed event log per run. Gives the `/chat-run` surface
 * durable replay-then-tail: every appended event gets a monotonic `cursor`, so
 * a reconnecting client can ask for everything after the last cursor it saw and
 * then tail live appends. The gateway's own SSE is consume-once; this store is
 * what makes a mid-run tab reload free.
 */
import type { ChatServerEvent } from '@agent-deck/protocol'

export type RunSubscriber = (event: ChatServerEvent) => void

/** Events that close a run (no more output will follow). */
const TERMINAL_EVENTS = new Set<ChatServerEvent['event']>([
  'run.completed',
  'run.failed',
  'run.cancelled',
])

interface RunState {
  events: ChatServerEvent[]
  done: boolean
  cursor: number
  subscribers: Set<RunSubscriber>
  /** Wall-clock of the last append; the idle sweep evicts non-terminal runs
   * quiet past the idle window (defense in depth against a never-terminal run
   * whose pump died without the store ever seeing a terminal frame). */
  lastActivityAt: number
  evictTimer?: ReturnType<typeof setTimeout>
}

export interface RunStoreOptions {
  /** How long a terminal run's event log is retained before eviction.
   * Defaults to 1h, matching the gateway's run retention. */
  terminalTtlMs?: number
  /** Hard cap on retained events per run (oldest dropped first). Guards against
   * an unbounded log on a pathological run. */
  maxEventsPerRun?: number
  /** How long a NON-terminal run may sit idle before the sweep evicts it.
   * Generous on purpose: a healthy run appends often, so only a wedged/abandoned
   * run that never reached a terminal frame should ever age out. Default 2h. */
  idleTtlMs?: number
  /** How often the idle sweep runs while ≥1 run is retained. Default 5m. */
  sweepIntervalMs?: number
  /** Hard cap on the number of retained runs. When exceeded, the oldest
   * non-terminal run is evicted so the map can't grow without bound. */
  maxRuns?: number
  /** Injectable clock (testing). Defaults to Date.now. */
  now?: () => number
}

/** Matches the gateway's ~3600s terminal-run retention. */
const DEFAULT_TERMINAL_TTL_MS = 3_600_000
/** Large sane bound; a normal run is far smaller. */
const DEFAULT_MAX_EVENTS_PER_RUN = 100_000
/** 2h: comfortably longer than any healthy run's gaps between frames. */
const DEFAULT_IDLE_TTL_MS = 7_200_000
/** Sweep every 5 minutes; cheap and coarse — this is a backstop, not the reaper. */
const DEFAULT_SWEEP_INTERVAL_MS = 300_000
/** Large sane bound on retained runs; normal usage is far smaller. */
const DEFAULT_MAX_RUNS = 10_000

export class RunStore {
  private readonly runs = new Map<string, RunState>()
  private readonly terminalTtlMs: number
  private readonly maxEventsPerRun: number
  private readonly idleTtlMs: number
  private readonly sweepIntervalMs: number
  private readonly maxRuns: number
  private readonly now: () => number
  /** The single idle-sweep interval; only runs while ≥1 run is retained. */
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: RunStoreOptions = {}) {
    this.terminalTtlMs = options.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS
    this.maxEventsPerRun = options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS
    this.now = options.now ?? Date.now
  }

  private ensure(runId: string): RunState {
    let state = this.runs.get(runId)
    if (!state) {
      state = {
        events: [],
        done: false,
        cursor: 0,
        subscribers: new Set(),
        lastActivityAt: this.now(),
      }
      this.runs.set(runId, state)
      this.enforceMaxRuns(runId)
      // A brand-new run is non-terminal: arm the idle sweep so a state created
      // by subscribe() alone (a subscribe-to-unknown-runId that may never
      // append) is still reaped/capped, not leaked. append() re-arms anyway.
      this.ensureSweep()
    }
    return state
  }

  /** Append an event, tag it with the next cursor, persist it, and notify
   * subscribers. Returns the stored (cursor-tagged) event. */
  append(runId: string, event: ChatServerEvent): ChatServerEvent {
    const state = this.ensure(runId)
    state.lastActivityAt = this.now()
    state.cursor += 1
    const tagged: ChatServerEvent = { ...event, cursor: state.cursor }
    state.events.push(tagged)
    // Cap retained events (drop oldest); cursors remain monotonic and truthful.
    if (state.events.length > this.maxEventsPerRun) {
      state.events.splice(0, state.events.length - this.maxEventsPerRun)
    }
    if (TERMINAL_EVENTS.has(tagged.event)) {
      state.done = true
      this.scheduleEviction(runId, state)
    } else {
      // A live (non-terminal) run keeps the idle sweep armed.
      this.ensureSweep()
    }
    for (const cb of state.subscribers) cb(tagged)
    return tagged
  }

  /**
   * Notify a run's subscribers of a TRANSIENT event WITHOUT buffering it: no
   * cursor is assigned, nothing is added to the replay log, so a later resume
   * never replays it. Used for run.heartbeat (a liveness signal, not transcript
   * content). It still counts as activity for the idle sweep — a heartbeating
   * run is alive, not abandoned. No-op for an unknown or already-terminal run
   * (a finished run cannot heartbeat; never resurrect or create state for one).
   */
  broadcast(runId: string, event: ChatServerEvent): void {
    const state = this.runs.get(runId)
    if (!state || state.done) return
    state.lastActivityAt = this.now()
    for (const cb of state.subscribers) cb(event)
  }

  /** When the runs map exceeds its cap, evict the oldest run to make room —
   * preferring a non-terminal one (terminal runs are already on a TTL clock and
   * may still be replayed). `keep` is the run we just inserted; never evict it. */
  private enforceMaxRuns(keep: string): void {
    while (this.runs.size > this.maxRuns) {
      const victim = this.oldestEvictable(keep)
      if (!victim) break
      this.evict(victim)
    }
  }

  /** The oldest evictable run id (prefer non-terminal; fall back to terminal),
   * skipping `keep`. Returns undefined when nothing else can be evicted. */
  private oldestEvictable(keep: string): string | undefined {
    let oldestNonTerminal: string | undefined
    let oldestNonTerminalAt = Infinity
    let oldestAny: string | undefined
    let oldestAnyAt = Infinity
    for (const [id, s] of this.runs) {
      if (id === keep) continue
      if (s.lastActivityAt < oldestAnyAt) {
        oldestAnyAt = s.lastActivityAt
        oldestAny = id
      }
      if (!s.done && s.lastActivityAt < oldestNonTerminalAt) {
        oldestNonTerminalAt = s.lastActivityAt
        oldestNonTerminal = id
      }
    }
    return oldestNonTerminal ?? oldestAny
  }

  /** Remove a run and tear down any pending eviction timer for it. */
  private evict(runId: string): void {
    const state = this.runs.get(runId)
    if (state?.evictTimer) clearTimeout(state.evictTimer)
    this.runs.delete(runId)
    this.maybeStopSweep()
  }

  /** Start the idle sweep if it isn't already running. */
  private ensureSweep(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs)
    // Never keep the process alive purely to sweep idle runs.
    this.sweepTimer.unref?.()
  }

  /** Stop sweeping once nothing is retained (no leaked interval). */
  private maybeStopSweep(): void {
    if (this.runs.size === 0 && this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /** One idle-sweep pass: evict any NON-terminal run quiet past the idle window.
   * Terminal runs are left to their TTL eviction. */
  private sweep(): void {
    const now = this.now()
    for (const [id, s] of this.runs) {
      if (s.done) continue
      if (now - s.lastActivityAt > this.idleTtlMs) this.evict(id)
    }
    this.maybeStopSweep()
  }

  /** Schedule eviction of a now-terminal run's log after the TTL. */
  private scheduleEviction(runId: string, state: RunState): void {
    if (state.evictTimer) clearTimeout(state.evictTimer)
    state.evictTimer = setTimeout(() => {
      if (this.runs.get(runId) === state) {
        this.runs.delete(runId)
        this.maybeStopSweep()
      }
    }, this.terminalTtlMs)
    // Don't keep the process alive purely for an eviction timer.
    state.evictTimer.unref?.()
  }

  /** True if this runId has ever been registered (has events, is done, or has
   * active subscribers). False for a completely unknown runId. */
  has(runId: string): boolean {
    return this.runs.has(runId)
  }

  /** Buffered events strictly after `afterCursor` (0 → all). */
  snapshot(runId: string, afterCursor = 0): ChatServerEvent[] {
    const state = this.runs.get(runId)
    if (!state) return []
    return state.events.filter((e) => (e.cursor ?? 0) > afterCursor)
  }

  isDone(runId: string): boolean {
    return this.runs.get(runId)?.done ?? false
  }

  subscribe(runId: string, cb: RunSubscriber): void {
    this.ensure(runId).subscribers.add(cb)
  }

  unsubscribe(runId: string, cb: RunSubscriber): void {
    this.runs.get(runId)?.subscribers.delete(cb)
  }
}
