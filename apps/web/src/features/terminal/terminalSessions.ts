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
 * its park/reattach. It folds the session's `id` and `epoch` together so that:
 *   - a plain browser refresh keeps the same key → the server REATTACHES (same shell),
 *   - a Restart (which bumps `epoch`) yields a NEW key → the server spawns a FRESH
 *     shell and the old parked one is reaped after its grace window.
 */
export function sessionKey(session: Pick<TerminalSession, 'id' | 'epoch'>): string {
  return `${session.id}:${session.epoch}`
}

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
    typeof s.epoch === 'number'
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
 */
export function restartSession(state: SessionsState, id: string): SessionsState {
  let changed = false
  const sessions = state.sessions.map((s) => {
    if (s.id !== id) return s
    changed = true
    return { ...s, epoch: s.epoch + 1 }
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
