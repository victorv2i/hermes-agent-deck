/**
 * Reasoning verbosity — a dual-audience control (Calm / Detailed).
 *
 * Newcomers want the transcript to stay quiet: reasoning and tool calls land
 * collapsed, summarized in plain language, never a wall of JSON (the "Calm"
 * default). A power user wants every chain and tool call expanded on arrival so
 * nothing is a click away ("Detailed"). This is opt-in and lives in Settings,
 * beside Density.
 *
 * Unlike density there is NO DOM reflection — this preference only drives the
 * `defaultOpen` of the reasoning + tool-call disclosures at render time. So this
 * module is a pure module-store (mirroring density.ts): a `useSyncExternalStore`
 * subscription, a localStorage-backed value, and imperative get/set — no React
 * provider, no `<html>` attribute, no scoped CSS.
 */
import { useSyncExternalStore } from 'react'

export type VerbosityMode = 'calm' | 'detailed'

export const REASONING_VERBOSITY_STORAGE_KEY = 'agent-deck-reasoning-verbosity'

const DEFAULT_VERBOSITY: VerbosityMode = 'calm'

function isVerbosity(value: unknown): value is VerbosityMode {
  return value === 'calm' || value === 'detailed'
}

/** Read the persisted verbosity, or null when unset/invalid/unavailable. */
export function readStoredVerbosity(): VerbosityMode | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(REASONING_VERBOSITY_STORAGE_KEY)
  return isVerbosity(v) ? v : null
}

// Module-level current value + subscribers. A tiny store (no Context provider)
// so the Settings toggle stays reactive and any number of
// `useReasoningVerbosity()` callers stay in sync, without threading a provider
// through the app shell.
let current: VerbosityMode = readStoredVerbosity() ?? DEFAULT_VERBOSITY
const listeners = new Set<() => void>()

/** The current verbosity (stored value, else the calm default). */
export function getVerbosity(): VerbosityMode {
  return current
}

/** Persist a verbosity and notify subscribers. */
export function setVerbosity(mode: VerbosityMode): void {
  current = mode
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(REASONING_VERBOSITY_STORAGE_KEY, mode)
    } catch {
      // Storage can throw (private mode / quota); the in-memory value still
      // takes effect for this session.
    }
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface UseReasoningVerbosity {
  verbosity: VerbosityMode
  setVerbosity: (mode: VerbosityMode) => void
  /** Flip between the two modes. */
  toggle: () => void
}

/**
 * Subscribe to the current verbosity. Reads from the module store via
 * `useSyncExternalStore`, so every caller and the imperative `setVerbosity()`
 * stay consistent.
 */
export function useReasoningVerbosity(): UseReasoningVerbosity {
  const verbosity = useSyncExternalStore(subscribe, getVerbosity, getVerbosity)
  return {
    verbosity,
    setVerbosity,
    toggle: () => setVerbosity(verbosity === 'detailed' ? 'calm' : 'detailed'),
  }
}
