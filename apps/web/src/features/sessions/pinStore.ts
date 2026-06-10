/**
 * Pinned-sessions store — a client-side "float to the top" affordance for the
 * session rail. The confirmed hermes dashboard build ships no pin/favorite
 * field, so this is purely local: the set of pinned session ids persists to
 * `localStorage['agent-deck-pinned-sessions']` as a JSON string array.
 *
 * Self-contained, no React provider: a module-level Set + `useSyncExternalStore`
 * keeps every rail row and the imperative toggle consistent, mirroring the
 * density / palette stores. Writes are tolerant of storage failures (private
 * mode / quota) — the in-memory set still drives this session.
 */
import { useSyncExternalStore } from 'react'

export const PINNED_SESSIONS_STORAGE_KEY = 'agent-deck-pinned-sessions'

/** Read the persisted pin set, tolerating missing/invalid/unavailable storage. */
export function readStoredPins(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

// Module-level current set + subscribers + a cached snapshot. `useSyncExternalStore`
// requires a STABLE reference between renders when nothing changed, so we hand
// out a frozen snapshot and only mint a new one on a real mutation.
let current = readStoredPins()
let snapshot: ReadonlySet<string> = current
const listeners = new Set<() => void>()

/** The current pinned-id set (stable reference until the next mutation). */
export function getPinnedSnapshot(): ReadonlySet<string> {
  return snapshot
}

function persist(set: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // Storage can throw (private mode / quota); the in-memory set still applies
    // for this session.
  }
}

function commit(next: Set<string>): void {
  current = next
  snapshot = next
  persist(next)
  for (const l of listeners) l()
}

/** Pin a session id (no-op if already pinned). */
export function pinSession(id: string): void {
  if (current.has(id)) return
  const next = new Set(current)
  next.add(id)
  commit(next)
}

/** Unpin a session id (no-op if not pinned). */
export function unpinSession(id: string): void {
  if (!current.has(id)) return
  const next = new Set(current)
  next.delete(id)
  commit(next)
}

/** Toggle a session id's pinned state. */
export function togglePin(id: string): void {
  if (current.has(id)) unpinSession(id)
  else pinSession(id)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Subscribe to the pinned-id set. Stays in sync with the imperative helpers. */
export function usePinnedSessions(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getPinnedSnapshot, getPinnedSnapshot)
}
