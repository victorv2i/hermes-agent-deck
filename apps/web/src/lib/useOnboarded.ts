/**
 * First-run "onboarded" flag — the single new preference this phase adds. Once
 * the newcomer has taken a real first action (started a chat, resumed a session,
 * or completed the first-run chat), they are "onboarded" and the integrator
 * lands them on Chat instead of the Home front door on subsequent visits.
 *
 * Shape mirrors `features/terminal/useTerminalAcknowledged.ts` — a one-bit
 * localStorage remember exposed as a `[flag, mark]` tuple with INJECTABLE storage
 * (`undefined` → real localStorage, `null` → no persistence, or an explicit stub
 * for tests). But the DEFAULT (non-injected) path is backed by a module-level
 * `useSyncExternalStore` store, so the rail, the Home route, and the integrator's
 * first-run landing logic all observe the SAME bit and re-render together when it
 * flips — no prop-drilling, mirroring the pin / density / palette stores.
 */
import { useCallback, useState, useSyncExternalStore } from 'react'

/** localStorage key recording that the user has completed first-run onboarding. */
export const ONBOARDED_KEY = 'agent-deck:onboarded'

/** Minimal storage surface (a slice of the Web Storage API), injectable for tests. */
export interface OnboardedStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Read the persisted flag, tolerating missing/unavailable storage. */
export function readStoredOnboarded(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return false
  }
}

// --- Shared store (the default path) ---------------------------------------
// A module-level boolean + subscribers so every default reader stays in sync.
let current = readStoredOnboarded()
const listeners = new Set<() => void>()

/** The current onboarded flag (stable primitive snapshot). */
export function getOnboardedSnapshot(): boolean {
  return current
}

/** First-run gate is OFF on the server (default surface stays Chat pre-hydrate). */
function getServerSnapshot(): boolean {
  return false
}

function persistDefault(value: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ONBOARDED_KEY, value ? '1' : '0')
  } catch {
    // Best-effort persistence; the in-memory flag still applies this session.
  }
}

function commit(next: boolean): void {
  if (current === next) return
  current = next
  persistDefault(next)
  for (const l of listeners) l()
}

/** Record that the user has been onboarded (idempotent, notifies subscribers). */
export function markOnboarded(): void {
  commit(true)
}

/**
 * Reset the onboarded flag back to first-run. Not used by the app UI — exported
 * for tests and a possible "show me the welcome again" affordance later.
 */
export function resetOnboarded(): void {
  commit(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------------------

/**
 * Track whether the user has completed first-run onboarding.
 *
 * Default (no argument / `undefined`): backed by the shared module store above,
 * so every caller re-renders together when the bit flips.
 *
 * Injected storage (`null` for no persistence, or a stub): an isolated instance
 * over the given storage — used by tests so the gate is exercisable without real
 * localStorage and without touching the shared store.
 */
export function useOnboarded(
  /** Explicit storage, `null` for no persistence, or `undefined` to use the shared store. */
  injected?: OnboardedStorage | null,
): [boolean, () => void] {
  // Default path: subscribe to the shared external store (hooks run unconditionally;
  // the isolated path below ignores this value).
  const shared = useSyncExternalStore(subscribe, getOnboardedSnapshot, getServerSnapshot)

  // Resolve the injection ONCE: `undefined` → shared store; anything else → isolated.
  const [resolved] = useState<OnboardedStorage | null | 'shared'>(() =>
    injected === undefined ? 'shared' : injected,
  )

  const [isolated, setIsolated] = useState<boolean>(() => {
    if (resolved === 'shared') return false
    try {
      return resolved?.getItem(ONBOARDED_KEY) === '1'
    } catch {
      return false
    }
  })

  const mark = useCallback(() => {
    if (resolved === 'shared') {
      markOnboarded()
      return
    }
    setIsolated(true)
    try {
      resolved?.setItem(ONBOARDED_KEY, '1')
    } catch {
      // Best-effort persistence; the in-session state still unblocks the gate.
    }
  }, [resolved])

  if (resolved === 'shared') return [shared, mark]
  return [isolated, mark]
}
