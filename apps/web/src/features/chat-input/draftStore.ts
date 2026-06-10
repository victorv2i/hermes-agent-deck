/**
 * Composer draft persistence — never lose a typed message.
 *
 * The composer text for each session is saved to localStorage under
 * `agent-deck:draft:<sessionId>` (and `agent-deck:draft:new` for the unsent
 * "new chat" composer), restored on reload/navigation, and cleared on send.
 *
 * This is deliberately self-contained — no React provider, no edit to the
 * composer. A direct localStorage read/write keyed by session, plus a small
 * `useDraft(sessionKey)` hook that seeds its initial value from storage and
 * persists changes on a debounce (so every keystroke doesn't hit storage). All
 * writes are tolerant of storage failures (private mode / quota): the in-memory
 * composer value still drives the current session.
 *
 * LOCAL-ONLY: the draft never leaves the browser.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** The key prefix for every per-session draft entry. */
export const DRAFT_STORAGE_PREFIX = 'agent-deck:draft:'

/** The sentinel session key for the unsent "new chat" composer. */
export const NEW_CHAT_DRAFT_KEY = 'new'

/** Debounce (ms) between the last keystroke and the storage write. */
export const DRAFT_SAVE_DEBOUNCE_MS = 400

/**
 * Resolve the localStorage key for a session. A null/empty session id (the
 * "new chat" composer, before a session exists) maps to the `:new` sentinel so
 * an in-progress new message survives a reload too.
 */
export function draftKey(sessionKey: string | null | undefined): string {
  const key = sessionKey && sessionKey.length > 0 ? sessionKey : NEW_CHAT_DRAFT_KEY
  return `${DRAFT_STORAGE_PREFIX}${key}`
}

/** Read a session's persisted draft, or `''` when unset/unavailable. */
export function readDraft(sessionKey: string | null | undefined): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(draftKey(sessionKey)) ?? ''
  } catch {
    return ''
  }
}

/**
 * Persist (or, for empty text, delete) a session's draft. Empty drafts are
 * removed so the resting storage stays clean and an empty composer reads as "no
 * draft". Tolerant of storage failures.
 */
export function writeDraft(sessionKey: string | null | undefined, text: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (text.length === 0) localStorage.removeItem(draftKey(sessionKey))
    else localStorage.setItem(draftKey(sessionKey), text)
  } catch {
    // Storage can throw (private mode / quota); the in-memory value still applies.
  }
}

/**
 * Seed a starter draft for a session WITHOUT clobbering one already in progress.
 * Used by the Home starter prompts: navigating to Chat with a chosen prompt
 * writes it here so the composer (which seeds its initial value from storage)
 * shows it. Returns true only if it actually wrote — an empty starter, or a
 * session that already has a draft (e.g. a back/refresh re-running stale
 * navigation state), is left untouched so a half-typed message is never lost.
 */
export function seedDraft(sessionKey: string | null | undefined, text: string): boolean {
  if (text.length === 0) return false
  if (readDraft(sessionKey).length > 0) return false
  writeDraft(sessionKey, text)
  return readDraft(sessionKey) === text
}

/** Remove a session's draft (used on send). Tolerant of storage failures. */
export function clearDraft(sessionKey: string | null | undefined): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(draftKey(sessionKey))
  } catch {
    // ignore
  }
}

export interface UseDraft {
  /** The current draft text (seeded from storage for this session). */
  draft: string
  /** Update the draft; persists on a debounce. */
  setDraft: (text: string) => void
  /** Clear the draft immediately (call this on send). */
  clear: () => void
}

/**
 * Per-session composer draft. Seeds from storage on mount (and re-seeds when the
 * session key changes), debounces writes, and exposes a `clear()` for send.
 *
 * The session key may be a session id, or null/`'new'` for the new-chat
 * composer; the same `draftKey` resolution applies.
 */
export function useDraft(sessionKey: string | null | undefined): UseDraft {
  const key = draftKey(sessionKey)
  const [draft, setDraftState] = useState<string>(() => readDraft(sessionKey))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-seed when the session changes (navigating between sessions / to new chat),
  // using React's adjust-state-during-render pattern (no effect → no cascading
  // render), mirroring FileBrowser's listing-key reset. A debounced write that's
  // still pending from the previous session is harmless: its timeout closed over
  // the OLD `key`, so it persists the OLD session's draft — exactly right.
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setDraftState(readDraft(sessionKey))
  }

  // Flush/cancel any pending debounced write on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // setDraft/clear close over the CURRENT resolved key, so they re-create on a
  // session change (cheap) and always target the right storage entry.
  const setDraft = useCallback(
    (text: string) => {
      setDraftState(text)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (typeof localStorage !== 'undefined') {
          try {
            if (text.length === 0) localStorage.removeItem(key)
            else localStorage.setItem(key, text)
          } catch {
            // ignore storage failures
          }
        }
      }, DRAFT_SAVE_DEBOUNCE_MS)
    },
    [key],
  )

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setDraftState('')
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key)
      } catch {
        // ignore
      }
    }
  }, [key])

  return { draft, setDraft, clear }
}
