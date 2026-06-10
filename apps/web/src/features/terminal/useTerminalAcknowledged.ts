import { useCallback, useState } from 'react'

/** localStorage key recording that the user acknowledged the real-shell warning. */
export const TERMINAL_ACK_KEY = 'agent-deck:terminal-acknowledged'

/** Minimal storage surface (a slice of the Web Storage API), injectable for tests. */
export interface AckStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): AckStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // Storage can throw (privacy mode / disabled) — degrade to in-memory (no persist).
    return null
  }
}

/**
 * Track whether the user has acknowledged the "this is a REAL shell on the host"
 * warning. First open shows the warning/acknowledge gate; once acknowledged it is
 * remembered (localStorage) so the terminal opens straight to the shell on later
 * visits. Storage is injectable so the gate is testable without real localStorage.
 */
export function useTerminalAcknowledged(
  /** Explicit storage, `null` for no persistence, or `undefined` to use localStorage. */
  injected?: AckStorage | null,
): [boolean, () => void] {
  // Resolve once: a passed `null` means "no persistence"; `undefined` means default.
  const [storage] = useState<AckStorage | null>(() =>
    injected === undefined ? defaultStorage() : injected,
  )
  const [acknowledged, setAcknowledged] = useState<boolean>(() => {
    try {
      return storage?.getItem(TERMINAL_ACK_KEY) === '1'
    } catch {
      return false
    }
  })

  const acknowledge = useCallback(() => {
    setAcknowledged(true)
    try {
      storage?.setItem(TERMINAL_ACK_KEY, '1')
    } catch {
      // Best-effort persistence; the in-session state still unblocks the terminal.
    }
  }, [storage])

  return [acknowledged, acknowledge]
}
