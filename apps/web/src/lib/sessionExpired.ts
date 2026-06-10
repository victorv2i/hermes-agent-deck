/**
 * ERR-01 — global 401 signal.
 *
 * When ANY /api call returns 401 (token missing or expired in a FORCE_AUTH/
 * remote deploy), apiFetch calls signalSessionExpired(). The app shell
 * observes this via useSyncExternalStore and swaps the entire content for the
 * SessionExpiredScreen — one unified surface instead of per-surface blank/error
 * states.
 *
 * Design constraints:
 *  - Idempotent: multiple 401s from concurrent queries only notify listeners once.
 *  - No loop: clearSessionExpired() is called AFTER a successful re-entry, so the
 *    interceptor never re-fires against the auth/check probe itself.
 */

type Listener = () => void
const listeners = new Set<Listener>()
let expired = false

function emit(): void {
  for (const listener of listeners) listener()
}

/** True when a 401 has been intercepted and not yet cleared. */
export function isSessionExpired(): boolean {
  return expired
}

/**
 * Signal that the session has expired. Idempotent — listeners are notified
 * only on the first call after clearSessionExpired().
 */
export function signalSessionExpired(): void {
  if (expired) return
  expired = true
  emit()
}

/**
 * Reset the expired state. Call after a successful re-entry so the app can
 * resume normal operation.
 */
export function clearSessionExpired(): void {
  if (!expired) return
  expired = false
  emit()
}

/** Subscribe to session-expired state changes (useSyncExternalStore-compatible). */
export function subscribeSessionExpired(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
