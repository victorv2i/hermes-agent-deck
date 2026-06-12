/**
 * `/agent-deck-terminal` Socket.IO namespace — the loopback interactive terminal.
 *
 * Each connected socket drives ONE pty (a real login shell spawned by node-pty,
 * see {@link ./ptyBridge}). Wire protocol:
 *
 *   client → server:
 *     'terminal.start'  { cols?, rows?, cwd?, sessionId?, attach? }  open/resume
 *     'terminal.input'  string                    keystrokes / paste
 *     'terminal.resize' { cols, rows }            window resize → pty.resize
 *     'terminal.close'  (no payload)              explicit close: end the session
 *   server → client:
 *     'terminal.ready'  { pid, resumed?, persistent? }  shell spawned (resumed=true
 *                                                  on reattach; persistent=true when
 *                                                  tmux-backed)
 *     'terminal.data'   string                    shell output (stdout+stderr)
 *     'terminal.exit'   { exitCode, detached? }   shell exited (detached=true when a
 *                                                  tmux client detached but the
 *                                                  session lives on)
 *     'terminal.error'  { message }               could not start (e.g. node-pty
 *                                                  unavailable) — UI shows it calmly
 *
 * TMUX PERSISTENCE (the strong layer, when tmux is installed):
 *  - A `terminal.start` with a stable `sessionId` is backed by a DECK-OWNED tmux
 *    session (`adk_*`, see {@link ./tmux}): the pty runs `tmux new-session -A`,
 *    so the shell lives in the tmux server and survives BFF restarts, arbitrarily
 *    long disconnects, and is shareable across devices (even the user's own
 *    `tmux attach`). On disconnect the pty CLIENT is simply disposed — no park
 *    buffer, no grace timer; the next start with the same id reattaches via -A.
 *  - `terminal.start` with `attach: <name>` attaches to a FOREIGN tmux session
 *    (one the user created). Attach only — the deck never creates or kills
 *    foreign sessions.
 *  - `terminal.close` (explicit user close): a deck-owned tmux session is
 *    killed; a foreign one is merely detached; a plain shell is killed.
 *  - AGENT_DECK_DISABLE_TMUX=1 (or no tmux on the host) falls back to the
 *    park/reattach machinery below, unchanged.
 *
 * PARK + REATTACH (refresh-survives fallback, no tmux):
 *  - When `terminal.start` carries a stable, client-supplied `sessionId`, a later
 *    socket 'disconnect' PARKS the pty (keeps it alive for a grace window) and
 *    buffers its output instead of killing it. A reconnect (a refresh, or a connect
 *    from another machine) that supplies the SAME `sessionId` REATTACHES to the live
 *    pty and replays the buffered scrollback — the SAME shell resumes. Bounded by a
 *    grace timeout, a max buffered-bytes tail, and the session cap.
 *  - With NO `sessionId` (the legacy raw path) a disconnect kills the pty
 *    immediately, exactly as before.
 *
 * SECURITY / LIFECYCLE:
 *  - Loopback-only: a connection from a non-loopback / non-Tailscale Origin is
 *    refused at the namespace middleware (the BFF already binds 127.0.0.1, this
 *    is defense-in-depth). NEVER expose this beyond loopback/Tailscale.
 *  - Session cap: at most {@link TerminalOptions.maxSessions} live ptys (live OR
 *    parked); over the cap a connection gets 'terminal.error' and no shell.
 *  - Teardown: a parked pty is reaped when its grace elapses; every pty is killed
 *    on namespace close, so no orphan shells leak.
 */
import type { Server as HttpServer } from 'node:http'
import { Server as SocketIOServer, type Namespace, type Socket } from 'socket.io'
import {
  spawnTerminal,
  loadNodePty,
  clampDim,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  type NodePtyLike,
  type PtyProcess,
} from './ptyBridge'
import { socketHandshakeOk, type AuthConfig } from '../auth/auth'
import { resolveCliPreset as defaultResolveCliPreset, type ResolvedCliPreset } from './cliDetector'
import {
  tmuxAvailable as defaultTmuxAvailable,
  deckSessionName,
  hasTmuxSession,
  killDeckSession,
  enableAggressiveResize,
  sendKeys,
  capturePane,
} from './tmux'

export const TERMINAL_NAMESPACE = '/agent-deck-terminal'

/** Hard cap on concurrent live ptys. Matches the web MAX_TERMINALS so the client
 * never lets you exceed what the server allows. */
const DEFAULT_MAX_SESSIONS = 12

/** How many scrollback lines are captured and replayed on a tmux reattach. */
const BACKFILL_LINES = 200

/** The dim delimiter line sent between the backfilled history and the live
 * screen the tmux attach repaints. Honest, minimal, and unambiguous in tests. */
const BACKFILL_MARKER = '\x1b[2m· reattached, recent history above ·\x1b[0m\r\n'

/** How long a parked (disconnected) pty stays alive awaiting a reattach before it
 * is reaped. Bounds how long an orphaned shell can linger after a closed tab. */
const DEFAULT_PARK_GRACE_MS = 5 * 60_000

/** Max scrollback bytes buffered per parked session for replay-on-reattach. Only
 * the most-recent tail is kept (older bytes drop) so a chatty shell can't grow
 * the buffer unbounded. */
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024

export interface TerminalOptions {
  /** Allowlisted workspace roots; the pty cwd falls back to the first one. */
  roots?: string[]
  /** Max concurrent live ptys. Default 12 (matches the web cap). */
  maxSessions?: number
  /**
   * How long a parked (disconnected) shell survives awaiting a reattach, in ms.
   * Default 5 min. Only applies when the client supplied a stable `sessionId`
   * (otherwise a disconnect kills the pty immediately, as before).
   */
  parkGraceMs?: number
  /** Max scrollback bytes buffered per session for replay-on-reattach. Default 256 KiB. */
  maxBufferBytes?: number
  /** Inject node-pty (a module or a loader) for hermetic tests. */
  nodePty?: NodePtyLike | (() => Promise<NodePtyLike | null>)
  /** Origin allowlist predicate; defaults to loopback / localhost / *.ts.net. */
  isAllowedOrigin?: (origin: string) => boolean
  /** Auth posture; when required, the handshake must carry a matching token.
   * Omitted/absent = no auth (loopback / tests). */
  auth?: AuthConfig
  /**
   * Whether the terminal is enabled on this bind. Default true (loopback). On a
   * remote bind without AGENT_DECK_ENABLE_TERMINAL=1 the integrator passes false,
   * and the namespace REFUSES every connection (defense-in-depth alongside the
   * REST status route reporting unavailable).
   */
  enabled?: boolean
  /** Permit a last-resort $HOME pty cwd when no workspace root resolves. */
  allowHome?: boolean
  /** Structured audit sink for session start/stop lines. Defaults to console. */
  audit?: (event: TerminalAuditEvent) => void
  /**
   * Resolve a launch preset id (from the `terminal.start` `cli` field) to a seed
   * command + label. MUST throw for an unavailable/unknown preset so we REJECT
   * before spawning (never type a command into a "command not found"). Injectable
   * for tests; defaults to the real {@link resolveCliPreset} (interactive-shell
   * detection). Returns `{ command: null }` for the raw shell (no seed).
   */
  resolveCliPreset?: (id: string) => Promise<ResolvedCliPreset>
  /**
   * Probe whether tmux can back persistent sessions. Injectable for tests;
   * defaults to the real {@link tmuxAvailable} (cached `tmux -V`, honoring
   * AGENT_DECK_DISABLE_TMUX=1).
   */
  tmuxAvailable?: () => Promise<boolean>
  /**
   * Extra tmux socket args (e.g. `['-L', 'adk_test_x']`) so tests run against a
   * THROWAWAY tmux server. Production omits this (the user's default server,
   * which is what makes deck sessions shareable with their own tmux).
   */
  tmuxSocketArgs?: string[]
}

/** A structured terminal-session audit record (NO secrets, NO shell I/O). */
export interface TerminalAuditEvent {
  event: 'terminal.session.start' | 'terminal.session.stop'
  pid: number
  cwd: string
  /** ISO-8601 timestamp. */
  time: string
  /** Present on stop: the shell's exit code, or null on a forced teardown. */
  exitCode?: number | null
}

/**
 * Default audit sink: a single structured JSON line on stdout per session
 * start/stop. It carries ONLY pid, cwd, time, and (on stop) the exit code — no
 * secrets and no shell input/output ever flow through here.
 */
function defaultAudit(event: TerminalAuditEvent): void {
  console.log(JSON.stringify({ msg: 'agent-deck.terminal', ...event }))
}

/** Loopback / localhost / Tailscale only. Mirrors the Fastify app allowlist;
 * kept feature-local so this module touches no shared file. */
export function isLoopbackOrigin(origin: string): boolean {
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.ts.net')
  )
}

interface StartPayload {
  cols?: number
  rows?: number
  cwd?: string
  /** Optional launch-preset id (e.g. `hermes`/`claude`/`codex`/`shell`). */
  cli?: string
  /** Optional stable, client-supplied session id enabling park/reattach. */
  sessionId?: string
  /** Optional FOREIGN tmux session name to attach to (never created/killed). */
  attach?: string
}

/** Bound a client-supplied session id so it can't be abused as a giant map key. */
const MAX_SESSION_ID_LEN = 128

function parseStart(payload: unknown): StartPayload {
  if (!payload || typeof payload !== 'object') return {}
  const p = payload as Record<string, unknown>
  const sessionId =
    typeof p.sessionId === 'string' &&
    p.sessionId.length > 0 &&
    p.sessionId.length <= MAX_SESSION_ID_LEN
      ? p.sessionId
      : undefined
  const attach =
    typeof p.attach === 'string' && p.attach.length > 0 && p.attach.length <= MAX_SESSION_ID_LEN
      ? p.attach
      : undefined
  return {
    cols: typeof p.cols === 'number' ? p.cols : undefined,
    rows: typeof p.rows === 'number' ? p.rows : undefined,
    cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
    cli: typeof p.cli === 'string' ? p.cli : undefined,
    sessionId,
    attach,
  }
}

function parseResize(payload: unknown): { cols: number; rows: number } | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (typeof p.cols !== 'number' || typeof p.rows !== 'number') return null
  return { cols: clampDim(p.cols, DEFAULT_COLS), rows: clampDim(p.rows, DEFAULT_ROWS) }
}

/**
 * Register the terminal namespace on an existing Socket.IO server. Tracks managed
 * ptys (live + parked) keyed by stable session id so they can be reattached on
 * reconnect and reaped on grace/close. Exposed separately from
 * {@link attachTerminal} so the namespace can be co-mounted on a shared io.
 */
export function registerTerminalHandlers(
  io: SocketIOServer,
  options: TerminalOptions = {},
): Namespace {
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  const parkGraceMs = options.parkGraceMs ?? DEFAULT_PARK_GRACE_MS
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
  const allowed = options.isAllowedOrigin ?? isLoopbackOrigin
  const loader = options.nodePty ?? loadNodePty
  const enabled = options.enabled ?? true
  const audit = options.audit ?? defaultAudit
  const resolveCliPreset = options.resolveCliPreset ?? defaultResolveCliPreset
  const canTmux = options.tmuxAvailable ?? (() => defaultTmuxAvailable())
  const tmuxSocketArgs = options.tmuxSocketArgs
  const namespace = io.of(TERMINAL_NAMESPACE)

  /**
   * Every managed pty (live OR parked), keyed by its STABLE session id. An
   * anonymous (no-`sessionId`) shell uses a synthetic per-socket key so the cap
   * counts it too, but it is never reattachable (it is dropped on disconnect).
   *
   * `sink` is the active socket receiving the pty's output, or null while PARKED
   * (the output is appended to `buffer` for replay instead). The pty's onData/
   * onExit are wired ONCE at spawn so reattach just swaps the sink (re-registering
   * on real node-pty would stack listeners).
   */
  interface ManagedSession {
    pty: PtyProcess
    pid: number
    cwd: string
    /** The socket currently attached, or null while parked. */
    sink: Socket | null
    /** Most-recent output tail buffered for replay-on-reattach (bounded). */
    buffer: string
    /** True for reattachable (stable-id) sessions; false for anonymous shells. */
    reattachable: boolean
    /**
     * The tmux session backing this pty, when tmux-backed. The pty is then just
     * a tmux CLIENT: disconnect disposes it immediately (no park — tmux holds
     * the shell) and a client exit may be a mere DETACH, not a shell death.
     */
    tmuxName?: string
    /** True when the backing tmux session is deck-owned (`adk_*`, killable). */
    deckOwned?: boolean
    /** The park-reap timer, set while parked, cleared on reattach/exit. */
    parkTimer: ReturnType<typeof setTimeout> | null
    /** Fired exactly once when the pty exits or is reaped (for the stop audit). */
    onClosed: (exitCode: number | null) => void
    closed: boolean
  }

  /** All managed sessions (live + parked) keyed by stable session id. */
  const sessions = new Map<string, ManagedSession>()

  /** Append to a session's bounded replay buffer, keeping only the newest tail. */
  const appendBuffer = (s: ManagedSession, data: string): void => {
    s.buffer += data
    if (s.buffer.length > maxBufferBytes) {
      s.buffer = s.buffer.slice(s.buffer.length - maxBufferBytes)
    }
  }

  /** Fully dispose a session: kill the pty, clear its timer, drop it from the map. */
  const disposeSession = (id: string, exitCode: number | null): void => {
    const s = sessions.get(id)
    if (!s) return
    if (s.parkTimer) {
      clearTimeout(s.parkTimer)
      s.parkTimer = null
    }
    if (!s.closed) {
      s.closed = true
      try {
        s.pty.kill()
      } catch {
        // already dead
      }
      sessions.delete(id)
      s.onClosed(exitCode)
    } else {
      sessions.delete(id)
    }
  }

  // GATING: on a remote bind without AGENT_DECK_ENABLE_TERMINAL=1 the terminal is
  // disabled. Refuse EVERY connection at the handshake (the REST status route also
  // reports it unavailable, so the UI shows a calm panel rather than a dead socket).
  if (!enabled) {
    namespace.use((_socket, next) => {
      next(new Error('terminal disabled'))
    })
    return namespace
  }

  // Defense-in-depth: refuse non-loopback origins at the handshake. A missing
  // Origin (same-origin / non-browser) is allowed, matching the HTTP CORS rule.
  namespace.use((socket, next) => {
    const origin = socket.handshake.headers.origin
    if (!origin || allowed(origin)) {
      next()
      return
    }
    next(new Error('forbidden origin'))
  })

  // C1: gate the handshake on a non-loopback bind. The browser sends the token as
  // handshake `auth: { token }`; a missing/mismatched token is refused before a
  // shell is ever spawned. No-op when auth is not required (loopback/tests).
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

  namespace.on('connection', (socket: Socket) => {
    let started = false
    /** The id of the session this socket is bound to (set on start/reattach). */
    let boundId: string | null = null

    socket.on('terminal.start', async (payload: unknown) => {
      // One shell per socket; ignore duplicate starts.
      if (started) return
      started = true

      const { cols, rows, cwd, cli, sessionId, attach } = parseStart(payload)

      // REATTACH (in-memory, non-tmux fallback): a stable session id that names a
      // still-managed (live/parked) pty resumes the SAME shell — swap the sink,
      // replay the buffered scrollback, and cancel the park-reap timer. No new
      // pty, no cap charge. (tmux-backed sessions are never keyed by the bare
      // sessionId, so they always take the tmux create-or-attach path below.)
      if (sessionId) {
        const existing = sessions.get(sessionId)
        if (existing) {
          if (existing.parkTimer) {
            clearTimeout(existing.parkTimer)
            existing.parkTimer = null
          }
          // If a stale socket is still attached (multi-machine: a second client
          // takes over), detach it so output only flows to the newest socket.
          existing.sink = socket
          boundId = sessionId
          // Replay the buffered tail so the user sees the prior scrollback, then
          // signal a resume so the client knows this is the SAME shell.
          if (existing.buffer) socket.emit('terminal.data', existing.buffer)
          socket.emit('terminal.ready', { pid: existing.pid, resumed: true })
          return
        }
      }

      // The cap counts every managed session (live OR parked) so a refresh storm
      // can't exhaust it — a reattach above never reaches here.
      if (sessions.size >= maxSessions) {
        socket.emit('terminal.error', {
          message: 'Too many terminal sessions are open. Close one and try again.',
        })
        started = false
        return
      }

      // CLI PRESET: resolve (and gate) the requested launcher preset BEFORE we
      // spawn. An unavailable/unknown preset is REJECTED here — we never spawn a
      // shell and type a command into a "command not found". `command: null` is
      // the raw shell (no seed). With no `cli` field this is skipped entirely
      // (today's raw-shell path).
      let seedCommand: string | null = null
      if (cli !== undefined) {
        try {
          const preset = await resolveCliPreset(cli)
          seedCommand = preset.command
        } catch {
          socket.emit('terminal.error', {
            message: `That CLI isn't installed on this host, so it can't be launched here.`,
          })
          started = false
          return
        }
      }

      // TMUX BACKING: with tmux on the host, a stable-id session rides a
      // DECK-OWNED tmux session — the shell lives in the tmux server, so it
      // survives BFF restarts and any disconnect gap, and is shareable across
      // devices. `attach` targets a FOREIGN session instead (attach only).
      let tmuxSpec: { mode: 'deck' | 'foreign'; sessionName: string } | null = null
      let tmuxResumed = false
      if (attach) {
        if (!(await canTmux())) {
          socket.emit('terminal.error', {
            message: 'tmux is not available on this host, so sessions cannot be attached.',
          })
          started = false
          return
        }
        // Attach NEVER creates: a missing foreign name is refused honestly here
        // (and the spawn below uses attach-session without -A as the backstop).
        if (!(await hasTmuxSession(attach, tmuxSocketArgs))) {
          socket.emit('terminal.error', {
            message: 'That tmux session does not exist anymore.',
          })
          started = false
          return
        }
        tmuxSpec = { mode: 'foreign', sessionName: attach }
        // A foreign attach always joins a PRE-EXISTING shell (the existence
        // check above), so it is honestly a resume too — the client gets the
        // same `resumed` signal (and the scrollback backfill below).
        tmuxResumed = true
      } else if (sessionId && (await canTmux())) {
        const name = deckSessionName(sessionId)
        // Known BEFORE the spawn so the client can be told this is a resume (-A
        // makes create-vs-attach one path, including across a BFF restart).
        tmuxResumed = await hasTmuxSession(name, tmuxSocketArgs)
        tmuxSpec = { mode: 'deck', sessionName: name }
      }

      // SCROLLBACK BACKFILL (resume only): capture the pane's recent history
      // BEFORE the tmux client spawns, so the capture can never race the live
      // attach redraw. It is replayed to the client first, then the dim marker
      // line, and only then does the attach repaint the live screen — history
      // first, delimiter, live screen. (The redraw repaints the CURRENT
      // screenful, which is also the tail of the capture; that overlap is the
      // honest cost of letting tmux own the live repaint.)
      let backfill: string | null = null
      if (tmuxSpec && tmuxResumed) {
        backfill = await capturePane(tmuxSpec.sessionName, BACKFILL_LINES, tmuxSocketArgs).catch(
          () => null,
        )
      }

      let spawned: Awaited<ReturnType<typeof spawnTerminal>>
      try {
        spawned = await spawnTerminal(
          {
            cols,
            rows,
            cwd,
            roots: options.roots,
            allowHome: options.allowHome,
            tmux: tmuxSpec ? { ...tmuxSpec, socketArgs: tmuxSocketArgs } : undefined,
          },
          loader,
        )
      } catch (err) {
        socket.emit('terminal.error', {
          message:
            err instanceof Error && /terminal unavailable/i.test(err.message)
              ? 'Terminal unavailable: the terminal backend could not start on this host.'
              : 'Terminal failed to start.',
        })
        started = false
        return
      }

      const proc = spawned.pty
      // The socket may have disconnected while we were spawning — don't leak.
      if (socket.disconnected) {
        try {
          proc.kill()
        } catch {
          // ignore
        }
        return
      }

      // Replay the captured history NOW, before the pty's onData is wired below
      // (same synchronous block), so the client always sees: history, marker
      // line, then the live screen tmux repaints. capture-pane emits bare \n
      // line endings; xterm needs \r\n.
      if (backfill !== null) {
        const history = backfill.replace(/\r?\n/g, '\r\n')
        socket.emit(
          'terminal.data',
          history + (history.endsWith('\r\n') ? '' : '\r\n') + BACKFILL_MARKER,
        )
      }

      // A stable id makes the session reattachable; an anonymous shell gets a
      // synthetic per-socket key (counted by the cap, but never resumable).
      // A tmux-backed session is keyed PER CLIENT: reattach happens in tmux
      // (`-A`), never via the in-memory map, and two devices on the same id are
      // two tmux clients sharing one session.
      const id = tmuxSpec
        ? `tmux:${tmuxSpec.sessionName}:${socket.id}`
        : (sessionId ?? `anon:${socket.id}`)
      boundId = id
      const s: ManagedSession = {
        pty: proc,
        pid: proc.pid,
        cwd: spawned.cwd,
        sink: socket,
        buffer: '',
        // tmux holds the shell; the in-memory park machinery stays out of it.
        reattachable: tmuxSpec ? false : sessionId !== undefined,
        tmuxName: tmuxSpec?.sessionName,
        deckOwned: tmuxSpec?.mode === 'deck',
        parkTimer: null,
        closed: false,
        onClosed: (exitCode) => {
          // AUDIT (no secrets, no shell I/O): a structured server log on stop.
          audit({
            event: 'terminal.session.stop',
            pid: proc.pid,
            cwd: spawned.cwd,
            time: new Date().toISOString(),
            exitCode,
          })
        },
      }
      sessions.set(id, s)
      // AUDIT (no secrets, no shell I/O): a structured server log on session start.
      audit({
        event: 'terminal.session.start',
        pid: proc.pid,
        cwd: spawned.cwd,
        time: new Date().toISOString(),
      })
      // Wired ONCE: stream output to the current sink AND keep a bounded tail
      // buffered, so a reattach (refresh / another machine) can replay the recent
      // scrollback — whether the bytes arrived live or while parked. For a
      // reattachable session we always buffer; an anonymous one never reattaches,
      // so it skips the buffer entirely.
      proc.onData((data) => {
        if (s.sink) s.sink.emit('terminal.data', data)
        if (s.reattachable) appendBuffer(s, data)
      })
      proc.onExit(({ exitCode }) => {
        if (s.closed) return
        if (s.tmuxName) {
          // A tmux CLIENT exit is not necessarily a shell death: a detach (the
          // user's `tmux detach`, or another client's takeover) leaves the
          // session alive in the tmux server. Distinguish honestly via a
          // session-still-exists check before reporting.
          const name = s.tmuxName
          void hasTmuxSession(name, tmuxSocketArgs)
            .catch(() => false)
            .then((stillExists) => {
              if (s.closed) return
              s.closed = true
              s.sink?.emit(
                'terminal.exit',
                stillExists ? { exitCode, detached: true } : { exitCode },
              )
              try {
                proc.kill()
              } catch {
                // already dead
              }
              sessions.delete(id)
              // A detach is NOT a shell death: audit it like a teardown (null).
              s.onClosed(stillExists ? null : exitCode)
            })
          return
        }
        s.closed = true
        s.sink?.emit('terminal.exit', { exitCode })
        if (s.parkTimer) {
          clearTimeout(s.parkTimer)
          s.parkTimer = null
        }
        // Release the native pty even on a natural exit (defensive; mirrors the
        // prior teardown so node-pty resources never linger).
        try {
          proc.kill()
        } catch {
          // already dead
        }
        sessions.delete(id)
        s.onClosed(exitCode)
      })
      // Best effort: size the shared tmux session to the most-recently-active
      // client instead of the smallest attached one (multi-device comfort).
      if (tmuxSpec?.mode === 'deck') {
        void enableAggressiveResize(tmuxSpec.sessionName, tmuxSocketArgs)
      }
      const ready: { pid: number; resumed?: boolean; persistent?: boolean } = { pid: proc.pid }
      if (tmuxSpec) ready.persistent = true
      if (tmuxResumed) ready.resumed = true
      socket.emit('terminal.ready', ready)
      // Seed the preset's command into the user's own shell (transparent — they
      // SEE it run, and an alias/function/version-shim resolves exactly as typed).
      // Fixed internal command string → no injection surface. NEVER into a
      // resumed tmux session (it already ran on creation) or a foreign one.
      //
      // KNOWN RACE (accepted): two devices FIRST-starting the same stable id at
      // the same time can both observe tmuxResumed=false (both checked before
      // either `-A` created the session) and both seed, running the preset
      // command twice. There is no creator signal from `new-session -A` to
      // re-check against, and deck ids carry a per-page-load random token, so
      // two devices sharing a brand-new id requires deliberate effort. The
      // window is one spawn (~100ms); the worst case is a visible duplicated
      // command in the same shell, never a wrong shell.
      if (seedCommand && !tmuxResumed && tmuxSpec?.mode !== 'foreign') {
        if (tmuxSpec) {
          // Writing to the tmux client this early can be EATEN by its pty line
          // discipline (the client is still entering raw mode), so seed through
          // the tmux server instead: wait for `-A` to create the session, then
          // send-keys — the command is still visibly typed into the shell.
          const name = tmuxSpec.sessionName
          void (async () => {
            for (let i = 0; i < 100; i += 1) {
              if (s.closed) return
              if (await hasTmuxSession(name, tmuxSocketArgs)) {
                await sendKeys(name, seedCommand, tmuxSocketArgs)
                return
              }
              await new Promise((r) => setTimeout(r, 50))
            }
          })().catch(() => {
            // best effort: a failed seed leaves a plain shell, never a crash
          })
        } else {
          proc.write(`${seedCommand}\r`)
        }
      }
    })

    socket.on('terminal.input', (data: unknown) => {
      const s = boundId ? sessions.get(boundId) : null
      if (s && s.sink === socket && typeof data === 'string') s.pty.write(data)
    })

    socket.on('terminal.resize', (payload: unknown) => {
      const dims = parseResize(payload)
      const s = boundId ? sessions.get(boundId) : null
      if (s && s.sink === socket && dims) s.pty.resize(dims.cols, dims.rows)
    })

    // EXPLICIT CLOSE (the user said "done", not a mere tab drop):
    //  - deck-owned tmux session → kill it in the tmux server too (its whole
    //    point was outliving disconnects; an explicit close ends it for real)
    //  - foreign tmux session → only detach (never kill what the user created)
    //  - plain shell → kill immediately (no park grace)
    socket.on('terminal.close', () => {
      if (!boundId) return
      const s = sessions.get(boundId)
      if (!s || s.sink !== socket) return
      if (s.tmuxName && s.deckOwned) {
        void killDeckSession(s.tmuxName, tmuxSocketArgs).catch(() => {
          // already gone (e.g. the shell exited) — disposal below still applies
        })
      }
      disposeSession(boundId, null)
    })

    socket.on('disconnect', () => {
      if (!boundId) return
      const s = sessions.get(boundId)
      // Only act on OUR session, and only if this socket is still the live sink (a
      // later reattach from another socket already took over → leave it running).
      if (!s || s.sink !== socket) return
      if (!s.reattachable) {
        // Anonymous (no stable id) shell: force-kill immediately, as before.
        // tmux-backed sessions also land here: disposing kills only the tmux
        // CLIENT pty — the shell lives on in the tmux server, and the next
        // start with the same stable id reattaches via `new-session -A` (even
        // across a BFF restart). No park buffer, no grace timer needed.
        disposeSession(boundId, null)
        return
      }
      // PARK: detach the sink (output now buffers) and start the grace-reap timer.
      // A reattach with the same id before it fires resumes the SAME shell.
      s.sink = null
      if (s.parkTimer) clearTimeout(s.parkTimer)
      const id = boundId
      s.parkTimer = setTimeout(() => disposeSession(id, null), parkGraceMs)
      // Don't keep the process alive for a parked shell that no one resumes.
      s.parkTimer.unref?.()
    })
  })

  // Kill every managed pty (live + parked) when the namespace's server closes.
  io.engine.on('close', () => {
    for (const id of [...sessions.keys()]) {
      disposeSession(id, null)
    }
  })

  return namespace
}

/**
 * Attach the terminal namespace to a Fastify app's underlying HTTP server,
 * mirroring `attachChat`. Returns the Socket.IO server so the caller can close
 * it (which also kills live ptys). Loopback-only CORS at the io layer.
 */
export function attachTerminal(
  httpServer: HttpServer,
  options: TerminalOptions = {},
): SocketIOServer {
  const allowed = options.isAllowedOrigin ?? isLoopbackOrigin
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, cb) => cb(null, !origin || allowed(origin)),
      credentials: false,
    },
  })
  registerTerminalHandlers(io, options)
  return io
}
