/**
 * Run-notification preference (A1) — the LOCAL on/off switch for the run
 * notifications surfaced by {@link useRunNotifications}, plus an honest read of
 * the browser's real `Notification.permission`.
 *
 * Two independent facts the operator controls / sees:
 *   - ENABLED: an in-browser preference ("ping me when a run finishes/needs me").
 *     Persisted to localStorage; ON by default (a long run pinging you when it's
 *     done is the whole point). When OFF, the subscriber stays fully silent.
 *   - PERMISSION: the BROWSER's grant for the OS-level Notification. We never
 *     fabricate this — {@link readNotificationPermission} reads the live value so
 *     the toggle can show the truth ("granted" / "default — ask" / "blocked" /
 *     "unsupported") and never claim to notify when the browser said no.
 *
 * Honesty boundary: even when enabled AND granted, browser notifications only
 * fire while a tab is open (see ./swNotify). This module does not pretend
 * otherwise; that off-device delivery is hermes' own Telegram channel.
 *
 * Self-contained like the density / send-key stores: a module-level value +
 * `useSyncExternalStore`, no React provider, no edit to the app shell.
 */
import { useSyncExternalStore } from 'react'

export const NOTIFICATIONS_ENABLED_STORAGE_KEY = 'agent-deck:notifications-enabled'

/** ON by default — a finished long run (or a blocking approval) should ping you. */
const DEFAULT_ENABLED = true

/** Read the persisted enable flag, or the default when unset/invalid/unavailable. */
export function readNotificationsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return DEFAULT_ENABLED
  try {
    const v = localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY)
    if (v === 'true') return true
    if (v === 'false') return false
    return DEFAULT_ENABLED
  } catch {
    return DEFAULT_ENABLED
  }
}

// Module-level store (no Context provider) so the Settings toggle and the headless
// subscriber stay in sync, mirroring density/send-key.
let current: boolean = readNotificationsEnabled()
const listeners = new Set<() => void>()

/** The current enable flag (stored value, else the default). */
export function getNotificationsEnabled(): boolean {
  return current
}

/** Persist the enable flag and notify subscribers. Tolerant of storage failures. */
export function setNotificationsEnabled(enabled: boolean): void {
  current = enabled
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(NOTIFICATIONS_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
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

export interface UseNotificationsEnabled {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

/**
 * Subscribe to the current enable flag. Reads the module store via
 * `useSyncExternalStore`, so the Settings control and the headless subscriber
 * stay consistent.
 */
export function useNotificationsEnabled(): UseNotificationsEnabled {
  const enabled = useSyncExternalStore(subscribe, getNotificationsEnabled, getNotificationsEnabled)
  return { enabled, setEnabled: setNotificationsEnabled }
}

/**
 * The browser's permission for OS-level notifications, as an HONEST status:
 *   - 'granted'     — the browser will show notifications,
 *   - 'default'     — not yet asked (the operator can opt in),
 *   - 'denied'      — the browser blocked them (we must NOT claim to notify),
 *   - 'unsupported' — no Notification API at all (SSR, sandbox, old browser).
 *
 * Reads the live `Notification.permission` off the provided global (defaults to
 * `window`). Never throws — a locked-down context degrades to 'unsupported'.
 */
export type NotificationPermissionStatus = NotificationPermission | 'unsupported'

interface NotificationGlobal {
  Notification?: { permission?: NotificationPermission }
}

export function readNotificationPermission(
  globalObj: NotificationGlobal | undefined = typeof window !== 'undefined' ? window : undefined,
): NotificationPermissionStatus {
  try {
    const perm = globalObj?.Notification?.permission
    if (perm === 'granted' || perm === 'denied' || perm === 'default') return perm
    return 'unsupported'
  } catch {
    // Accessing the property can throw in locked-down contexts.
    return 'unsupported'
  }
}
