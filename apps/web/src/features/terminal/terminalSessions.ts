import type { CliId } from './useTerminalClis'

/**
 * Pure, framework-agnostic state for the Terminal's MULTI-TERMINAL surface. One
 * {@link TerminalSession} per live pty (each session = its own socket = its own
 * shell on the server). The reducer owns:
 *   - open/close with an honest 12-terminal CAP,
 *   - a single ACTIVE session (the focused/visible one in tab view, the amber
 *     LIVE one in grid view),
 *   - rename + in-place restart (epoch bump → the view remounts a fresh shell),
 *   - the tab ⇄ grid VIEW MODE toggle.
 *
 * It is intentionally side-effect-free + serializable so it is trivially testable
 * and could be lifted into a store later. Mutating helpers return the SAME object
 * reference when nothing changed (cap reached, unknown id) so React can bail out.
 */

/** The hard cap on concurrent terminals (matches the server's session cap). */
export const MAX_TERMINALS = 12

export type ViewMode = 'tab' | 'grid'

export interface TerminalSession {
  /** Stable unique id (also the React key + the per-session socket scope). */
  id: string
  /** The launcher preset this session was opened with. */
  cli: CliId
  /** Human label shown on the tab / grid cell (renamable; defaults from cli). */
  title: string
  /** Bumped by {@link restartSession} to force a fresh remount (new shell). */
  epoch: number
  /**
   * A FOREIGN tmux session name this tab attaches to (one the user created in
   * their own tmux). The view sends `attach` instead of `sessionId`; the tab's
   * close affordance is DETACH (the deck never kills a foreign session).
   */
  attach?: string
  /**
   * A RECOVERED deck session's raw wire id (the server's `adk_<wire>` name
   * minus the prefix), set when the server list knew a deck-owned session this
   * browser's storage forgot. {@link sessionKey} sends it verbatim so the
   * reattach maps back to the SAME tmux session name.
   */
  wire?: string
  /**
   * Marked at load time on every session RESTORED from localStorage (see
   * {@link markRestored}): the UI expects the server to REATTACH an existing
   * shell, so a ready frame WITHOUT `resumed` means the old shell quietly ended
   * and a fresh one took its place (worth saying honestly). Cleared by
   * {@link restartSession} because a Restart asks for a fresh shell on purpose.
   */
  restored?: boolean
}

export interface SessionsState {
  sessions: TerminalSession[]
  /** The focused session id (null only when there are zero sessions). */
  activeId: string | null
  viewMode: ViewMode
  /** Monotonic counter backing unique ids + default titles. */
  seq: number
}

/** Friendly default labels per preset (the index disambiguates same-cli tabs). */
const CLI_TITLE: Record<CliId, string> = {
  hermes: 'Hermes',
  claude: 'Claude',
  codex: 'Codex',
  shell: 'Shell',
}

export function emptySessions(viewMode: ViewMode = 'tab'): SessionsState {
  return { sessions: [], activeId: null, viewMode, seq: 0 }
}

/**
 * The STABLE WIRE id sent to the server as `terminal.start` `sessionId`, driving
 * its park/reattach (and, with tmux, the `adk_*` session name). It folds the
 * session's `id` and `epoch` together so that:
 *   - a plain browser refresh keeps the same key → the server REATTACHES (same shell),
 *   - a Restart (which bumps `epoch`) yields a NEW key → the server spawns a FRESH
 *     shell. The OLD shell's fate depends on its backing: a non-tmux parked pty is
 *     reaped after its grace window, but a tmux-backed one would survive under its
 *     old adk_ name — so the multi-view kills a known-persistent session
 *     (terminal.close) before bumping the epoch.
 * A RECOVERED session sends its `wire` id verbatim at epoch 0 (so the key maps
 * back to the SAME `adk_*` tmux name); a Restart suffixes the epoch as usual,
 * which honestly becomes a new session name (a fresh shell).
 */
export function sessionKey(session: Pick<TerminalSession, 'id' | 'epoch' | 'wire'>): string {
  if (session.wire) return session.epoch > 0 ? `${session.wire}:${session.epoch}` : session.wire
  return `${session.id}:${session.epoch}`
}

/**
 * The deck-owned tmux session name a wire key maps to on the server — a client
 * mirror of the server's deckSessionName (`adk_` + everything outside
 * [A-Za-z0-9_-] replaced by `-`, bounded to 100 chars). Used to reconcile the
 * server's session list against localStorage.
 */
export function deckTmuxName(wireKey: string): string {
  return `adk_${wireKey.replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 100)
}

/** The `adk_` ownership prefix marking a tmux session as deck-created. */
export const DECK_TMUX_PREFIX = 'adk_'

/** localStorage key remembering the tab ⇄ grid layout across reloads. */
export const TERMINAL_VIEW_MODE_KEY = 'agent-deck:terminal-view-mode'

function isViewMode(value: unknown): value is ViewMode {
  return value === 'tab' || value === 'grid'
}

/**
 * Read the persisted view mode (tab/grid), defaulting to 'tab' when unset,
 * invalid, or storage is unavailable. Pure read — tolerant of private-mode throws.
 */
export function readViewMode(): ViewMode {
  if (typeof localStorage === 'undefined') return 'tab'
  try {
    const v = localStorage.getItem(TERMINAL_VIEW_MODE_KEY)
    return isViewMode(v) ? v : 'tab'
  } catch {
    return 'tab'
  }
}

/** Persist the view mode so it survives a reload. Best-effort (tolerates throws). */
export function writeViewMode(mode: ViewMode): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TERMINAL_VIEW_MODE_KEY, mode)
  } catch {
    // Storage can throw (private mode / quota); the in-session state still applies.
  }
}

/**
 * localStorage key remembering the OPEN terminal sessions across reloads, so a
 * browser refresh remounts the SAME sessions (same stable ids) and the server can
 * REATTACH each to its parked shell — the crown-jewel "refresh resumes the same
 * shell" behavior. We store only the serializable session list + activeId +
 * viewMode + seq (no sockets / engines).
 */
export const TERMINAL_SESSIONS_KEY = 'agent-deck:terminal-sessions'

function isSession(value: unknown): value is TerminalSession {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return (
    typeof s.id === 'string' &&
    typeof s.cli === 'string' &&
    typeof s.title === 'string' &&
    typeof s.epoch === 'number' &&
    (s.attach === undefined || typeof s.attach === 'string') &&
    (s.wire === undefined || typeof s.wire === 'string')
  )
}

/**
 * Read the persisted open-session list, or null when absent/invalid (the caller
 * falls back to opening a single fresh session). Tolerant of corrupt JSON and
 * private-mode throws. Restores `activeId` only when it names a restored session.
 */
export function readPersistedSessions(): SessionsState | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null
  try {
    raw = localStorage.getItem(TERMINAL_SESSIONS_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  if (!Array.isArray(p.sessions) || !p.sessions.every(isSession)) return null
  const sessions = p.sessions as TerminalSession[]
  if (sessions.length === 0) return null
  const ids = new Set(sessions.map((s) => s.id))
  const activeId =
    typeof p.activeId === 'string' && ids.has(p.activeId) ? p.activeId : sessions[0]!.id
  const viewMode = isViewMode(p.viewMode) ? p.viewMode : 'tab'
  const seq = typeof p.seq === 'number' && Number.isFinite(p.seq) ? p.seq : sessions.length
  return { sessions, activeId, viewMode, seq }
}

/**
 * Persist the open-session list so a reload restores it. An empty list CLEARS the
 * key (so a fully-closed terminal doesn't resurrect ghost tabs). Best-effort.
 */
export function writeSessions(state: SessionsState): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (state.sessions.length === 0) {
      localStorage.removeItem(TERMINAL_SESSIONS_KEY)
      return
    }
    const payload = {
      sessions: state.sessions,
      activeId: state.activeId,
      viewMode: state.viewMode,
      seq: state.seq,
    }
    localStorage.setItem(TERMINAL_SESSIONS_KEY, JSON.stringify(payload))
  } catch {
    // Storage can throw (private mode / quota); the in-session state still applies.
  }
}

/** True when the cap is reached and no more terminals may be opened. */
export function isAtCap(state: SessionsState): boolean {
  return state.sessions.length >= MAX_TERMINALS
}

/**
 * Open a new terminal for `cli`, making it active. No-op (same reference) once the
 * cap is reached — the UI surfaces an honest "max reached" state rather than
 * silently dropping the request.
 */
/**
 * A short, collision-resistant random token. Appended to session ids so a stable
 * id from one page load never collides with another load's `term-1` — critical
 * now the server PARKS shells by this id (a reused id would reattach to the wrong
 * parked shell). Uses crypto when available, else Math.random (ids stay unique
 * within a load via `seq`; the random part only needs to differ across loads).
 */
function randomToken(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

export function openSession(state: SessionsState, cli: CliId): SessionsState {
  if (isAtCap(state)) return state
  const seq = state.seq + 1
  const id = `term-${seq}-${randomToken()}`
  const session: TerminalSession = {
    id,
    cli,
    title: `${CLI_TITLE[cli]} ${seq}`,
    epoch: 0,
  }
  return {
    ...state,
    sessions: [...state.sessions, session],
    activeId: id,
    seq,
  }
}

/**
 * Open a tab ATTACHED to a foreign tmux session (one the user created in their
 * own tmux), making it active. The tab is titled with the session's name (its
 * honest identity on the tmux server) and carries `attach`, so the view joins
 * the existing shell instead of creating one. Cap-honest like {@link openSession}.
 */
export function openAttachSession(state: SessionsState, name: string): SessionsState {
  if (isAtCap(state)) return state
  // One tab per foreign session: attaching again just refocuses the open tab.
  const existing = state.sessions.find((s) => s.attach === name)
  if (existing) return setActive(state, existing.id)
  const seq = state.seq + 1
  const session: TerminalSession = {
    id: `term-${seq}-${randomToken()}`,
    cli: 'shell',
    title: name,
    epoch: 0,
    attach: name,
  }
  return {
    ...state,
    sessions: [...state.sessions, session],
    activeId: session.id,
    seq,
  }
}

/**
 * Open a RECOVERED tab for a deck-owned tmux session (`adk_*`) the server still
 * holds but this browser's storage forgot (e.g. after browser data loss). The
 * recovered `wire` id reproduces the same tmux name, so mounting the tab
 * reattaches the SAME shell. Titled with the wire id (the only identity left).
 */
export function openRecoveredSession(state: SessionsState, serverName: string): SessionsState {
  if (isAtCap(state)) return state
  if (!serverName.startsWith(DECK_TMUX_PREFIX)) return state
  const wire = serverName.slice(DECK_TMUX_PREFIX.length)
  if (!wire) return state
  const seq = state.seq + 1
  const session: TerminalSession = {
    id: `term-${seq}-${randomToken()}`,
    cli: 'shell',
    title: wire,
    epoch: 0,
    wire,
  }
  return {
    ...state,
    sessions: [...state.sessions, session],
    activeId: session.id,
    seq,
  }
}

/**
 * Mark every session in a freshly-RESTORED state as `restored` (the UI expects
 * each to reattach its previous shell). Called once on the state read back from
 * localStorage, before any reconcile or fresh opens. Pure.
 */
export function markRestored(state: SessionsState): SessionsState {
  if (state.sessions.length === 0) return state
  return { ...state, sessions: state.sessions.map((s) => ({ ...s, restored: true })) }
}

/**
 * Whether the UI expects this session's NEXT ready frame to be a reattach
 * (`resumed:true`): it was restored from storage, or recovered from the
 * server's tmux list (a `wire` id at its original epoch 0). A ready WITHOUT
 * `resumed` on such a session means the old shell ended and `new-session -A`
 * quietly created a fresh one. A brand-new open (and any Restart, which bumps
 * the epoch and clears `restored`) expects a fresh shell, so never matches.
 */
export function expectsResume(session: TerminalSession): boolean {
  return session.restored === true || (session.wire !== undefined && session.epoch === 0)
}

/** The tmux session name a local entry maps to on the server (attach entries
 * name a foreign session; everything else rides a deck-owned `adk_*` name). */
export function expectedTmuxName(session: TerminalSession): string {
  return session.attach ?? deckTmuxName(sessionKey(session))
}

/** The slice of the server's `GET /terminal/sessions` payload reconcile needs. */
export interface ServerTmuxSnapshot {
  tmuxAvailable: boolean
  sessions: { name: string; deckOwned: boolean }[]
}

/**
 * Reconcile the restored localStorage sessions against the SERVER's tmux list —
 * the source of truth for what is actually running:
 *   - entries whose tmux session no longer exists are CLEANED (the shell is
 *     gone; remounting would silently create a fresh one that masquerades as
 *     the old),
 *   - deck-owned (`adk_*`) server sessions no local entry maps to are RECOVERED
 *     as tabs (so shells survive browser data loss),
 *   - without tmux on the host nothing changes (volatile sessions keep the
 *     in-process park/reattach behavior).
 * Pure; returns the SAME reference when nothing changed.
 */
export function reconcileSessions(state: SessionsState, server: ServerTmuxSnapshot): SessionsState {
  if (!server.tmuxAvailable) return state
  const serverNames = new Set(server.sessions.map((s) => s.name))
  const kept = state.sessions.filter((s) => serverNames.has(expectedTmuxName(s)))
  let next: SessionsState = state
  if (kept.length !== state.sessions.length) {
    const ids = new Set(kept.map((s) => s.id))
    next = {
      ...state,
      sessions: kept,
      activeId: state.activeId && ids.has(state.activeId) ? state.activeId : (kept[0]?.id ?? null),
    }
  }
  const known = new Set(kept.map((s) => expectedTmuxName(s)))
  for (const srv of server.sessions) {
    if (!srv.deckOwned || known.has(srv.name)) continue
    next = openRecoveredSession(next, srv.name)
  }
  // Recovered tabs should not steal focus from a surviving active session.
  if (next !== state && state.activeId && next.sessions.some((s) => s.id === state.activeId)) {
    next = { ...next, activeId: state.activeId }
  }
  return next
}

/**
 * A compact relative age for epoch SECONDS (the tmux created/activity stamps):
 * "just now", "3m ago", "2h ago", "5d ago". Honest floor rounding.
 */
export function formatEpochAge(epochSeconds: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - epochSeconds)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Close a session. If it was the active one, focus an adjacent neighbor (the
 * previous tab, else the next) so the surface never lands on "nothing selected"
 * while sessions remain. Closing the last session clears `activeId`.
 */
export function closeSession(state: SessionsState, id: string): SessionsState {
  const idx = state.sessions.findIndex((s) => s.id === id)
  if (idx === -1) return state
  const sessions = state.sessions.filter((s) => s.id !== id)
  let activeId = state.activeId
  if (state.activeId === id) {
    if (sessions.length === 0) {
      activeId = null
    } else {
      // Prefer the previous neighbor, else the new tab at this index (clamped into
      // range so we always land on a real session that remains).
      const at = Math.min(Math.max(idx - 1, 0), sessions.length - 1)
      activeId = sessions[at]!.id
    }
  }
  return { ...state, sessions, activeId }
}

/** Rename a session. A blank/whitespace-only title is ignored (keeps the prior). */
export function renameSession(state: SessionsState, id: string, title: string): SessionsState {
  const trimmed = title.trim()
  if (!trimmed) return state
  if (!state.sessions.some((s) => s.id === id)) return state
  const sessions = state.sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s))
  return { ...state, sessions }
}

/**
 * In-place restart: bump the session's epoch so the host view remounts a fresh
 * socket + shell (deterministic, no navigate). Id + title + cli are preserved.
 * Drops the `restored` marker: a restart asks for a FRESH shell on purpose, so
 * the fresh-shell notice must not fire for it ({@link expectsResume}).
 */
export function restartSession(state: SessionsState, id: string): SessionsState {
  let changed = false
  const sessions = state.sessions.map((s) => {
    if (s.id !== id) return s
    changed = true
    const { restored: _dropped, ...rest } = s
    return { ...rest, epoch: s.epoch + 1 }
  })
  if (!changed) return state
  return { ...state, sessions }
}

/** Focus a session by id. Unknown id = no-op (same reference). */
export function setActive(state: SessionsState, id: string): SessionsState {
  if (state.activeId === id) return state
  if (!state.sessions.some((s) => s.id === id)) return state
  return { ...state, activeId: id }
}

/** Switch the tab ⇄ grid view mode. */
export function setViewMode(state: SessionsState, viewMode: ViewMode): SessionsState {
  if (state.viewMode === viewMode) return state
  return { ...state, viewMode }
}
