import type { SessionNavDirection } from './useGlobalShortcuts'

/**
 * Pure helper for j/k session quick-switching (P5). Given the ordered rail
 * session ids, the id currently open (or null), and a direction, return the id
 * to navigate to next — or null when there's nowhere to move.
 *
 * Rules (kept deliberately calm for a power user holding a key):
 *  - From "nothing open" (`currentId == null`): `next` lands on the FIRST row,
 *    `prev` on the LAST.
 *  - Otherwise step ±1 and CLAMP at the ends (no wrap-around — holding j at the
 *    bottom doesn't jump back to the top).
 *  - Returns null when the move would stay on the current id (already at the end,
 *    or an empty list), so the caller can skip a redundant navigation.
 */
export function nextSessionId(
  sessionIds: string[],
  currentId: string | null,
  direction: SessionNavDirection,
): string | null {
  if (sessionIds.length === 0) return null

  const current = currentId === null ? -1 : sessionIds.indexOf(currentId)
  const step = direction === 'next' ? 1 : -1

  let nextIndex: number
  if (current === -1) {
    nextIndex = direction === 'next' ? 0 : sessionIds.length - 1
  } else {
    nextIndex = Math.min(Math.max(current + step, 0), sessionIds.length - 1)
  }

  const target = sessionIds[nextIndex]
  if (target === undefined || target === currentId) return null
  return target
}
