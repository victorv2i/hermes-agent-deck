/**
 * Voice preferences — a tiny self-contained store for the composer's voice
 * features (spec, voice features 1–2).
 *
 * Currently it holds a single flag, `autoSpeak` (OFF by default — opt-in TTS per
 * the spec: "an opt-in auto-speak setting, off by default"). It is modelled
 * exactly on `features/settings/density.ts`: a module-level value + a
 * `useSyncExternalStore` subscription (no React provider, no app-shell edit) so
 * the Settings toggle and any number of `useVoicePrefs()` callers stay in sync,
 * with the chosen value persisted to localStorage.
 *
 * LOCAL-ONLY: nothing here leaves the browser.
 */
import { useSyncExternalStore } from 'react'

export const VOICE_PREFS_STORAGE_KEY = 'agent-deck:voice'

export interface VoicePrefs {
  /** Speak assistant replies aloud automatically as they arrive. Opt-in. */
  autoSpeak: boolean
}

const DEFAULT_PREFS: VoicePrefs = { autoSpeak: false }

function isVoicePrefs(value: unknown): value is VoicePrefs {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { autoSpeak?: unknown }).autoSpeak === 'boolean'
  )
}

/** Read the persisted prefs, or null when unset/invalid/unavailable. */
export function readStoredVoicePrefs(): VoicePrefs | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(VOICE_PREFS_STORAGE_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    // Tolerate forward-compatible extra keys by normalising to the known shape.
    if (isVoicePrefs(parsed)) return { autoSpeak: parsed.autoSpeak }
    return null
  } catch {
    return null
  }
}

// Module-level current value + subscribers (mirrors density.ts).
let current: VoicePrefs = readStoredVoicePrefs() ?? DEFAULT_PREFS
const listeners = new Set<() => void>()

/** The current prefs (stored value, else the defaults). */
export function getVoicePrefs(): VoicePrefs {
  return current
}

/** Persist + apply a full prefs object and notify subscribers. */
export function setVoicePrefs(prefs: VoicePrefs): void {
  current = prefs
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // Storage can throw (private mode / quota); the in-memory value still
      // takes effect for this session.
    }
  }
  for (const l of listeners) l()
}

/** Toggle/set the auto-speak flag (a focused setter for the Settings toggle). */
export function setAutoSpeak(autoSpeak: boolean): void {
  setVoicePrefs({ ...current, autoSpeak })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface UseVoicePrefs extends VoicePrefs {
  setAutoSpeak: (autoSpeak: boolean) => void
  /** Flip the auto-speak flag. */
  toggleAutoSpeak: () => void
}

/**
 * Subscribe to the current voice prefs. Reads from the module store via
 * `useSyncExternalStore`, so every caller and the imperative setters stay
 * consistent.
 */
export function useVoicePrefs(): UseVoicePrefs {
  const prefs = useSyncExternalStore(subscribe, getVoicePrefs, getVoicePrefs)
  return {
    ...prefs,
    setAutoSpeak,
    toggleAutoSpeak: () => setAutoSpeak(!prefs.autoSpeak),
  }
}
