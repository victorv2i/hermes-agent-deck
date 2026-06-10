/**
 * Small pure formatters for the Kanban surface. The plugin already computes age
 * deltas server-side (so cards colour stale work without a client clock), but it
 * hands them as raw seconds; these turn a second-count into a calm compact label.
 */

/** Compact duration from a second-count: 45 → "45s", 600 → "10m", 7200 → "2h",
 * 172800 → "2d". Null/negative/non-finite → null (the caller renders nothing). */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

/** Max characters for a card's displayed title before it's clipped with an ellipsis. */
const TITLE_CAP = 80

/**
 * A scannable card title from a raw task title. Tasks created from a chat run use the
 * WHOLE prompt as the title (up to ~19k chars), so a card needs a sensible display:
 * the first non-empty line, clipped to ~{@link TITLE_CAP} chars on a word boundary
 * with an ellipsis. The full title stays reachable via the card's `title` tooltip and
 * the task drawer. An all-whitespace/empty title collapses to a calm fallback so a
 * card is never blank.
 */
export function cardTitle(raw: string): string {
  // First non-empty line: prompt-derived titles are "<gist>\n\n<long body>".
  const firstLine = raw.split('\n').find((line) => line.trim() !== '') ?? ''
  const trimmed = firstLine.trim()
  if (trimmed === '') return 'Untitled task'
  if (trimmed.length <= TITLE_CAP) return trimmed

  const clipped = trimmed.slice(0, TITLE_CAP)
  // Prefer a word boundary if one sits reasonably close to the cap, so we don't leave
  // a dangling partial word; otherwise hard-clip (e.g. a single very long token).
  const lastSpace = clipped.lastIndexOf(' ')
  const base = lastSpace > TITLE_CAP - 16 ? clipped.slice(0, lastSpace) : clipped
  return `${base.trimEnd()}…`
}
