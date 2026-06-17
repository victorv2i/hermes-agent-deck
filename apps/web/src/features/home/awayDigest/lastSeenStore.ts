/**
 * The "last seen the deck" timestamp store: the only persistence the away-digest
 * needs. It records (in localStorage, as unix ms) when the operator last had the
 * deck open, so the next return can compute what happened in between.
 *
 * Deliberately a tiny read/write pair (no React, no subscription): the digest
 * hook READS the previous value, computes the digest against it, then WRITES
 * `now`, exactly once per mount. Writes tolerate storage failures (private mode /
 * quota); a failed write simply means the next return computes from the older
 * mark, which is harmless.
 */

export const AWAY_LAST_SEEN_STORAGE_KEY = 'agent-deck-away-last-seen'

/** Read the stored last-seen ms, or null when absent/corrupt/unavailable. */
export function readLastSeenAt(): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(AWAY_LAST_SEEN_STORAGE_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** Persist the last-seen ms, tolerating a throwing/unavailable storage. */
export function writeLastSeenAt(ms: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(AWAY_LAST_SEEN_STORAGE_KEY, String(ms))
  } catch {
    // private mode / quota: the next return just computes from the older mark.
  }
}
