/**
 * Send-key preference — does Enter send, or insert a newline?
 *
 * Two modes, persisted to localStorage (`agent-deck:send-key`):
 *   - `enter`     (default): Enter sends; ⌘/Ctrl+Enter inserts a newline.
 *   - `mod-enter`         : ⌘/Ctrl+Enter sends; Enter inserts a newline.
 *
 * Shift+Enter ALWAYS inserts a newline (the universal "soft return"), in both
 * modes, so the convention never surprises. The pure {@link shouldSend} helper
 * decides per keydown; the composer reads it so a key handler stays a one-liner.
 *
 * Self-contained like the density/palette stores: a module-level value +
 * `useSyncExternalStore`, no React provider. LOCAL-ONLY.
 */
import { useSyncExternalStore } from 'react'

export type SendKeyPref = 'enter' | 'mod-enter'

export const SEND_KEY_STORAGE_KEY = 'agent-deck:send-key'

export const DEFAULT_SEND_KEY: SendKeyPref = 'enter'

function isSendKeyPref(value: unknown): value is SendKeyPref {
  return value === 'enter' || value === 'mod-enter'
}

/** Read the persisted preference, or the default when unset/invalid/unavailable. */
export function readSendKeyPref(): SendKeyPref {
  if (typeof localStorage === 'undefined') return DEFAULT_SEND_KEY
  try {
    const v = localStorage.getItem(SEND_KEY_STORAGE_KEY)
    return isSendKeyPref(v) ? v : DEFAULT_SEND_KEY
  } catch {
    return DEFAULT_SEND_KEY
  }
}

// Module-level store (no Context provider) so the Settings control and every
// composer stay in sync, mirroring density/palette.
let current: SendKeyPref = readSendKeyPref()
const listeners = new Set<() => void>()

/** The current preference (stored value, else the default). */
export function getSendKeyPref(): SendKeyPref {
  return current
}

/** Persist a preference and notify subscribers. Tolerant of storage failures. */
export function setSendKeyPref(pref: SendKeyPref): void {
  current = pref
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SEND_KEY_STORAGE_KEY, pref)
    } catch {
      // Storage can throw (private mode / quota); the in-memory value still applies.
    }
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The minimal shape {@link shouldSend} inspects — a subset of a React/DOM
 * keyboard event. Accepting this (not the full event) keeps the helper pure and
 * trivially testable, and works for both React.KeyboardEvent and native ones.
 */
export interface SendKeyEvent {
  key: string
  shiftKey: boolean
  /** ⌘ on macOS. */
  metaKey: boolean
  /** Ctrl elsewhere. */
  ctrlKey: boolean
  /** Composing IME text — Enter commits the composition, never sends. */
  isComposing?: boolean
  /** A `keyCode` of 229 also signals an in-progress IME composition. */
  keyCode?: number
}

/**
 * Decide whether a keydown should SEND the message (vs. insert a newline), given
 * the user's preference.
 *
 *   - Only the Enter key is ever a send candidate.
 *   - An in-progress IME composition (isComposing / keyCode 229) never sends —
 *     Enter is committing the composition.
 *   - Shift+Enter ALWAYS inserts a newline (returns false) in both modes.
 *   - `enter` mode: plain Enter sends; Mod+Enter does not (→ newline).
 *   - `mod-enter` mode: ⌘/Ctrl+Enter sends; plain Enter does not (→ newline).
 *
 * The caller calls `preventDefault()` + send when this returns true, and
 * otherwise lets the textarea insert the newline.
 */
export function shouldSend(e: SendKeyEvent, pref: SendKeyPref): boolean {
  if (e.key !== 'Enter') return false
  if (e.isComposing || e.keyCode === 229) return false
  if (e.shiftKey) return false
  const mod = e.metaKey || e.ctrlKey
  if (pref === 'mod-enter') return mod
  // 'enter' mode: plain Enter only (a modifier means "newline").
  return !mod
}

export interface UseSendKeyPref {
  pref: SendKeyPref
  setPref: (pref: SendKeyPref) => void
}

/**
 * Subscribe to the current send-key preference. Reads the module store via
 * `useSyncExternalStore`, so the Settings control and the composer stay
 * consistent.
 */
export function useSendKeyPref(): UseSendKeyPref {
  const pref = useSyncExternalStore(subscribe, getSendKeyPref, getSendKeyPref)
  return { pref, setPref: setSendKeyPref }
}
