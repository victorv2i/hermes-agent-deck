/**
 * The TERMINAL DOCK store — a tiny Zustand singleton driving the single-session
 * terminal that lives in the right side panel, the SAME slot the Preview panel
 * and the Work panel share. Only ONE of the three may occupy that slot, so this
 * store is the coordination point: opening the dock CLOSES preview + work (and,
 * symmetrically, App.tsx closes the dock when preview/work open — those stores
 * aren't ours to edit, so that reverse half is wired in the host).
 *
 * Unlike the multi-terminal surface (`/terminal`, the power tool), the dock hosts
 * exactly ONE shell. To make that shell survive a browser refresh — reattaching
 * to its parked pty instead of spawning a fresh one — we mint a SINGLE stable
 * session id once and persist it in localStorage. `TerminalView` forwards that id
 * to `terminal.start` as its `sessionId`, which is what drives the server's
 * park/reattach (see terminalSessions.ts). The dock id is deliberately distinct
 * from the multi-view's `term-N` ids so the two surfaces never collide on a
 * parked shell.
 *
 * The id is minted+persisted ONCE at store creation (lazy initial state), not on
 * first read, so `dockSessionId()` is a pure getter — callers can read it during
 * a React render without triggering a `set()`-during-render side effect.
 */
import { create } from 'zustand'
import { usePreviewStore } from '@/features/preview/previewStore'
import { useWorkPanelStore } from '@/features/work-panel/workPanelStore'

/**
 * localStorage key holding the dock's single stable session id, so a refresh
 * reattaches to the SAME parked shell instead of spawning a new one.
 */
export const TERMINAL_DOCK_SESSION_KEY = 'agent-deck:terminal-dock-session'

/**
 * A short, collision-resistant token for the dock session id. Mirrors the
 * multi-view's approach (crypto when available, else Math.random) so the dock id
 * is unique across page loads even when storage was cleared.
 */
function randomToken(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 12)
  return Math.random().toString(36).slice(2, 14)
}

/** Read the persisted dock session id, tolerant of unavailable/throwing storage. */
function readPersistedId(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(TERMINAL_DOCK_SESSION_KEY)
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

/** Persist the dock session id (best-effort; tolerates private-mode throws). */
function writePersistedId(id: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TERMINAL_DOCK_SESSION_KEY, id)
  } catch {
    // Storage can throw (private mode / quota); the in-session id still applies.
  }
}

/**
 * Resolve the dock's stable session id ONCE, at store creation: reuse the
 * persisted id when present (refresh-reattach), else mint + persist a fresh one.
 * Doing this eagerly keeps `dockSessionId()` a pure getter (no render-phase set).
 * Exported for tests, which exercise the at-creation logic with controlled
 * storage (the store itself is a singleton minted at import time).
 */
export function initDockSessionId(): string {
  const persisted = readPersistedId()
  if (persisted) return persisted
  const minted = `dock-${randomToken()}`
  writePersistedId(minted)
  return minted
}

export interface TerminalPanelState {
  /** Whether the dock is open (occupying the side-panel slot). */
  open: boolean
  /** The minted/persisted, stable dock session id (set once at store creation). */
  sessionId: string

  /**
   * Open the dock. MUTUALLY EXCLUSIVE with the Preview + Work panels: opening the
   * dock closes both so only one occupant ever holds the single side-panel slot.
   */
  openDock: () => void
  /** Close the dock (the side panel collapses; the parked shell lives on). */
  close: () => void
  /** Toggle the dock. Opening closes preview + work; closing touches nothing else. */
  toggle: () => void
  /**
   * The dock's stable session id — minted once at store creation and persisted so
   * a browser refresh REATTACHES the same parked shell. A PURE getter (no `set()`),
   * so it is safe to call during a React render.
   */
  dockSessionId: () => string
}

/** Close the two sibling side-panel stores so the dock is the sole occupant. */
function closeSiblings(): void {
  if (usePreviewStore.getState().open) usePreviewStore.getState().close()
  if (useWorkPanelStore.getState().open) useWorkPanelStore.getState().close()
}

export const useTerminalPanelStore = create<TerminalPanelState>((set, get) => ({
  open: false,
  sessionId: initDockSessionId(),

  openDock: () => {
    closeSiblings()
    set({ open: true })
  },
  close: () => set({ open: false }),
  toggle: () => {
    if (get().open) {
      set({ open: false })
      return
    }
    closeSiblings()
    set({ open: true })
  },
  // Pure getter — the id is already resolved in initial state, so this never
  // mutates the store (safe to call during a React render).
  dockSessionId: () => get().sessionId,
}))
