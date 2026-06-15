import type {
  CliId,
  WorkspaceDefinition,
  WorkspacePaneDefinition,
  WorkspaceSummary,
} from '@agent-deck/protocol'
import { MAX_TERMINALS, type TerminalSession, type ViewMode } from './terminalSessions'

/**
 * Pure, framework-agnostic state for a single terminal WORKSPACE — a named,
 * server-persisted, freeform grid of panes (each pane = one CLI in one working
 * directory). It mirrors {@link ./terminalSessions} (its purity + tests are the
 * model) but for workspaces rather than ad-hoc tabs. The reducer owns:
 *   - add/remove panes with the same honest 12-pane CAP (shared MAX_TERMINALS),
 *   - a single ACTIVE pane (the focused/visible one),
 *   - rename + per-pane cli/cwd edits,
 *   - in-place restart (epoch bump → a NEW deterministic sessionId → fresh shell),
 *   - the tab/grid VIEW MODE toggle + 1/2/3/4/6 layout presets.
 *
 * The SERVER is authoritative for workspace definitions ({@link fromDefinition} /
 * {@link toPaneDefinitions} bridge to the protocol DTOs). localStorage is only a
 * cache + a last-active pointer, so on load the client fetches the server file
 * and reconciles. This module is intentionally side-effect-free + serializable
 * so it is trivially testable. Mutating helpers return the SAME object reference
 * when nothing changed (cap reached, unknown id) so React can bail out.
 */

export { MAX_TERMINALS, type ViewMode }

/** The pane-count layout presets the workspace grid offers. */
export const WORKSPACE_LAYOUT_PRESETS = [1, 2, 3, 4, 6] as const

export interface WorkspacePane {
  /** Stable pane id: the deterministic-sessionId input + the React key. */
  id: string
  /** Human label shown in the pane header / tab (renamable; defaults from cli). */
  label: string
  /** The launcher CLI; absent when the pane attaches a foreign tmux session. */
  cli?: CliId
  /** Working directory the pane launches in (server-validated before use). */
  cwd?: string
  /** A foreign tmux session this pane attaches to; mutually exclusive with cli. */
  attach?: string
  /**
   * Client-only restart counter. Bumped by {@link restartPane} to force a NEW
   * {@link paneSessionId} (a fresh shell). NEVER persisted into the server
   * definition ({@link toPaneDefinitions} drops it) — restart is a live action,
   * not part of the durable workspace shape.
   */
  epoch: number
}

export interface WorkspaceState {
  /** The server-assigned workspace id (also the localStorage cache namespace). */
  id: string
  name: string
  description?: string
  panes: WorkspacePane[]
  /** The focused pane id (null only when there are zero panes). */
  activePane: string | null
  viewMode: ViewMode
}

/** Friendly default labels per preset (the index disambiguates same-cli panes). */
const CLI_LABEL: Record<CliId, string> = {
  hermes: 'Hermes',
  claude: 'Claude',
  codex: 'Codex',
  shell: 'Shell',
}

/**
 * The DETERMINISTIC pty id every device computes for a pane, sent to the server
 * as `terminal.start` `sessionId`. It folds the workspace id, pane id, and epoch
 * together so any device opening the same workspace reattaches the SAME parked /
 * tmux-backed pty:
 *   - `ws_<workspaceId>_<paneId>` at epoch 0 (a plain reattach), and
 *   - `ws_<workspaceId>_<paneId>_<epoch>` once a Restart bumps the epoch (a new
 *     name → a fresh shell, honestly).
 * Workspace + pane ids are already constrained to a tmux/arg-safe charset by the
 * protocol, so the result is safe to use as a session name verbatim.
 */
export function paneSessionId(workspaceId: string, paneId: string, epoch: number): string {
  const base = `ws_${workspaceId}_${paneId}`
  return epoch > 0 ? `${base}_${epoch}` : base
}

/** A fresh, empty workspace state (no panes), defaulting to tab view. */
export function emptyWorkspace(id: string, name: string, viewMode: ViewMode = 'tab'): WorkspaceState {
  return { id, name, panes: [], activePane: null, viewMode }
}

/**
 * A short, collision-resistant random token appended to pane ids so two panes
 * added in different sessions never collide on `p1` (a reused id would reattach
 * to the wrong parked shell, given the deterministic sessionId). Uses crypto
 * when available, else Math.random. Constrained to the protocol pane-id charset.
 */
function randomToken(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** True when the cap is reached and no more panes may be added to this workspace. */
export function isAtCap(state: WorkspaceState): boolean {
  return state.panes.length >= MAX_TERMINALS
}

/**
 * Add a pane running `cli`, making it active. No-op (same reference) once the cap
 * is reached — the UI surfaces an honest "max reached" state rather than silently
 * dropping the request. The new pane id (`<cli>-<n>-<token>`) stays within the
 * protocol pane-id charset so it is a safe deterministic-sessionId input.
 */
export function addPane(state: WorkspaceState, cli: CliId): WorkspaceState {
  if (isAtCap(state)) return state
  const n = state.panes.length + 1
  const id = `${cli}-${n}-${randomToken()}`
  const pane: WorkspacePane = {
    id,
    label: `${CLI_LABEL[cli]} ${n}`,
    cli,
    epoch: 0,
  }
  return { ...state, panes: [...state.panes, pane], activePane: id }
}

/**
 * Remove a pane. If it was the active one, focus an adjacent neighbor (the
 * previous pane, else the next) so the surface never lands on "nothing selected"
 * while panes remain. Removing the last pane clears `activePane`.
 */
export function removePane(state: WorkspaceState, id: string): WorkspaceState {
  const idx = state.panes.findIndex((p) => p.id === id)
  if (idx === -1) return state
  const panes = state.panes.filter((p) => p.id !== id)
  let activePane = state.activePane
  if (state.activePane === id) {
    if (panes.length === 0) {
      activePane = null
    } else {
      const at = Math.min(Math.max(idx - 1, 0), panes.length - 1)
      activePane = panes[at]!.id
    }
  }
  return { ...state, panes, activePane }
}

/** Rename a pane. A blank/whitespace-only label is ignored (keeps the prior). */
export function renamePane(state: WorkspaceState, id: string, label: string): WorkspaceState {
  const trimmed = label.trim()
  if (!trimmed) return state
  if (!state.panes.some((p) => p.id === id)) return state
  const panes = state.panes.map((p) => (p.id === id ? { ...p, label: trimmed } : p))
  return { ...state, panes }
}

/**
 * Set a pane's launcher CLI. Drops any `attach` (cli and attach are mutually
 * exclusive — choosing a CLI means this pane runs it, not a foreign session).
 * Unknown id = no-op (same reference).
 */
export function setPaneCli(state: WorkspaceState, id: string, cli: CliId): WorkspaceState {
  if (!state.panes.some((p) => p.id === id)) return state
  const panes = state.panes.map((p) => {
    if (p.id !== id) return p
    const { attach: _dropped, ...rest } = p
    return { ...rest, cli }
  })
  return { ...state, panes }
}

/**
 * Set a pane's working directory. A blank/whitespace-only value CLEARS it (the
 * pane falls back to the server default cwd). The string is validated server-side
 * (realpath + allowlist) before any launch; this reducer only records intent.
 * Unknown id = no-op (same reference).
 */
export function setPaneCwd(state: WorkspaceState, id: string, cwd: string): WorkspaceState {
  if (!state.panes.some((p) => p.id === id)) return state
  const trimmed = cwd.trim()
  const panes = state.panes.map((p) => {
    if (p.id !== id) return p
    if (!trimmed) {
      const { cwd: _dropped, ...rest } = p
      return rest
    }
    return { ...p, cwd: trimmed }
  })
  return { ...state, panes }
}

/**
 * In-place restart: bump the pane's epoch so {@link paneSessionId} yields a NEW
 * id → the host view remounts a fresh socket + shell (deterministic, no
 * navigate). Id + label + cli + cwd are preserved. Unknown id = no-op.
 */
export function restartPane(state: WorkspaceState, id: string): WorkspaceState {
  let changed = false
  const panes = state.panes.map((p) => {
    if (p.id !== id) return p
    changed = true
    return { ...p, epoch: p.epoch + 1 }
  })
  if (!changed) return state
  return { ...state, panes }
}

/** Focus a pane by id. Unknown id = no-op (same reference). */
export function setActivePane(state: WorkspaceState, id: string): WorkspaceState {
  if (state.activePane === id) return state
  if (!state.panes.some((p) => p.id === id)) return state
  return { ...state, activePane: id }
}

/** Switch the tab/grid view mode. No-op (same reference) when unchanged. */
export function setViewMode(state: WorkspaceState, viewMode: ViewMode): WorkspaceState {
  if (state.viewMode === viewMode) return state
  return { ...state, viewMode }
}

/**
 * Resize the workspace to exactly `count` panes (one of the layout presets):
 *   - GROW by adding `shell` panes (the neutral default) up to `count`, capped at
 *     MAX_TERMINALS, and switch to grid view so the new cells are visible,
 *   - SHRINK by keeping the first `count` panes (re-pointing `activePane` if the
 *     active one was dropped).
 * A non-positive `count` is rejected (no-op). Returns the SAME reference when the
 * pane count already matches.
 */
export function applyLayoutPreset(state: WorkspaceState, count: number): WorkspaceState {
  if (!Number.isInteger(count) || count <= 0) return state
  const target = Math.min(count, MAX_TERMINALS)
  if (state.panes.length === target) return state
  if (state.panes.length < target) {
    let next: WorkspaceState = { ...state, viewMode: 'grid' }
    while (next.panes.length < target) next = addPane(next, 'shell')
    // Focus the first cell, not the last-added one: applying a layout is a grid
    // gesture, so the surface should land on the top-left pane.
    return { ...next, activePane: next.panes[0]!.id }
  }
  const panes = state.panes.slice(0, target)
  const ids = new Set(panes.map((p) => p.id))
  const activePane =
    state.activePane && ids.has(state.activePane) ? state.activePane : (panes[0]?.id ?? null)
  return { ...state, panes, activePane }
}

/**
 * Hydrate a {@link WorkspaceState} from the SERVER's authoritative definition.
 * Every pane starts at epoch 0 (a plain reattach to its parked shell); the first
 * pane is focused. Epoch is a client-only restart counter, so it never appears in
 * the durable definition.
 */
export function fromDefinition(def: WorkspaceDefinition): WorkspaceState {
  const panes: WorkspacePane[] = def.panes.map((p) => ({
    id: p.id,
    label: p.label,
    ...(p.cli !== undefined ? { cli: p.cli } : {}),
    ...(p.cwd !== undefined ? { cwd: p.cwd } : {}),
    ...(p.attach !== undefined ? { attach: p.attach } : {}),
    epoch: 0,
  }))
  return {
    id: def.id,
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    panes,
    activePane: panes[0]?.id ?? null,
    viewMode: 'tab',
  }
}

/**
 * Serialize the workspace's panes back into protocol {@link WorkspacePaneDefinition}s
 * for a `PATCH /workspaces/:id`. Drops the view-only `epoch` (a live restart
 * counter, not part of the durable definition).
 */
export function toPaneDefinitions(state: WorkspaceState): WorkspacePaneDefinition[] {
  return state.panes.map((p) => ({
    id: p.id,
    label: p.label,
    ...(p.cli !== undefined ? { cli: p.cli } : {}),
    ...(p.cwd !== undefined ? { cwd: p.cwd } : {}),
    ...(p.attach !== undefined ? { attach: p.attach } : {}),
  }))
}

/** The protocol pane-id charset (a tmux/process-arg-safe subset). */
const PANE_ID_CHARS = /[^A-Za-z0-9_-]/g

/**
 * Sanitize an arbitrary id into the protocol pane-id charset (`[A-Za-z0-9_-]`,
 * 1..64 chars), replacing anything else with `-` and falling back to a short
 * token when the whole id sanitizes away. Scratch session ids already comply, but
 * this keeps the Save-promote payload valid for any future id shape.
 */
function sanitizePaneId(id: string): string {
  const cleaned = id.replace(PANE_ID_CHARS, '-').slice(0, 64)
  return cleaned || `p-${randomToken()}`
}

/**
 * Build the panes for a Save-promote: convert the Scratch session list (the live
 * quick-terminal panes) into protocol {@link WorkspacePaneDefinition}s for a
 * `POST /workspaces`. Each pane carries the session's cli (or its foreign
 * `attach`) and label; Scratch sessions have no per-pane cwd, so none is sent (the
 * saved panes fall back to the server default cwd, exactly as they did ad-hoc).
 * Pane ids are sanitized into the protocol charset, deduped so two sessions never
 * collide on one pane id (a reused id would reattach to the wrong shell).
 */
export function panesFromSessions(sessions: TerminalSession[]): WorkspacePaneDefinition[] {
  const seen = new Set<string>()
  return sessions.map((s) => {
    let id = sanitizePaneId(s.id)
    while (seen.has(id)) id = sanitizePaneId(`${s.id}-${randomToken()}`)
    seen.add(id)
    const pane: WorkspacePaneDefinition = { id, label: s.title }
    // A foreign attach session promotes to an attach pane (no cli); everything
    // else carries its launcher cli.
    if (s.attach !== undefined) pane.attach = s.attach
    else pane.cli = s.cli
    return pane
  })
}

/**
 * localStorage key caching the workspace SUMMARY list (the picker renders from it
 * instantly, then revalidates against the authoritative server list on load).
 */
export const WORKSPACES_CACHE_KEY = 'agent-deck:workspaces'

/** Prefix for the per-workspace cached state key (one entry per workspace id). */
export const WORKSPACE_STATE_KEY_PREFIX = 'agent-deck:workspace:'

/** localStorage key remembering the last-opened workspace id (a UX pointer). */
export const LAST_WORKSPACE_KEY = 'agent-deck:last-workspace'

/** The per-workspace cached-state key for a given workspace id. */
export function workspaceStateKey(id: string): string {
  return `${WORKSPACE_STATE_KEY_PREFIX}${id}`
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'tab' || value === 'grid'
}

function isSummary(value: unknown): value is WorkspaceSummary {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.paneCount === 'number' &&
    typeof s.createdAt === 'string' &&
    typeof s.lastModifiedAt === 'string' &&
    (s.description === undefined || typeof s.description === 'string')
  )
}

function isPane(value: unknown): value is WorkspacePane {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.label === 'string' &&
    typeof p.epoch === 'number' &&
    (p.cli === undefined || typeof p.cli === 'string') &&
    (p.cwd === undefined || typeof p.cwd === 'string') &&
    (p.attach === undefined || typeof p.attach === 'string')
  )
}

/**
 * Read the cached workspace-summary list, or null when absent/invalid. Tolerant
 * of corrupt JSON and private-mode throws. The server list stays authoritative —
 * this is only a paint-fast cache the caller revalidates.
 */
export function readWorkspacesCache(): WorkspaceSummary[] | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null
  try {
    raw = localStorage.getItem(WORKSPACES_CACHE_KEY)
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
  if (!Array.isArray(parsed) || !parsed.every(isSummary)) return null
  return parsed as WorkspaceSummary[]
}

/** Cache the workspace-summary list. Best-effort (tolerates private-mode throws). */
export function writeWorkspacesCache(summaries: WorkspaceSummary[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(WORKSPACES_CACHE_KEY, JSON.stringify(summaries))
  } catch {
    // Storage can throw (private mode / quota); the server list still applies.
  }
}

/**
 * Read the cached per-workspace state (panes + active + view), or null when
 * absent/invalid. Tolerant of corrupt JSON and private-mode throws. The server
 * definition stays authoritative; this only restores the local view shape
 * (which pane is focused, tab vs grid) while the definition revalidates.
 */
export function readWorkspaceState(id: string): WorkspaceState | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null
  try {
    raw = localStorage.getItem(workspaceStateKey(id))
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
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return null
  if (!Array.isArray(p.panes) || !p.panes.every(isPane)) return null
  const panes = p.panes as WorkspacePane[]
  const ids = new Set(panes.map((pane) => pane.id))
  const activePane =
    typeof p.activePane === 'string' && ids.has(p.activePane)
      ? p.activePane
      : (panes[0]?.id ?? null)
  const viewMode = isViewMode(p.viewMode) ? p.viewMode : 'tab'
  return {
    id: p.id,
    name: p.name,
    ...(typeof p.description === 'string' ? { description: p.description } : {}),
    panes,
    activePane,
    viewMode,
  }
}

/** Cache the per-workspace state so a reload restores it. Best-effort. */
export function writeWorkspaceState(state: WorkspaceState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(workspaceStateKey(state.id), JSON.stringify(state))
  } catch {
    // Storage can throw (private mode / quota); the in-session state still applies.
  }
}

/** Read the last-opened workspace id pointer, or null when unset/unavailable. */
export function readLastWorkspaceId(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}

/** Remember (or, with null, clear) the last-opened workspace id. Best-effort. */
export function writeLastWorkspaceId(id: string | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (id === null) localStorage.removeItem(LAST_WORKSPACE_KEY)
    else localStorage.setItem(LAST_WORKSPACE_KEY, id)
  } catch {
    // Storage can throw (private mode / quota); the in-session pointer still applies.
  }
}
