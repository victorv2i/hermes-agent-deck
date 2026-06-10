/**
 * The in-repo "What's new" feed for the Home front door. A tiny, hand-curated
 * changelog (NOT a generated git log) — each entry is one shipped, user-facing
 * improvement worth surfacing on first run, newest first. Doubles as marketing
 * copy for screenshots/demos, so the tone is plain and benefit-led.
 *
 * Keep it SHORT: Home shows only the latest few (see `RECENT_CHANGELOG`). Add a
 * new entry at the TOP when something ships; prune the tail so this never grows
 * into a wall.
 */

export interface ChangelogEntry {
  /** Stable key for React lists + dedupe (kebab-case, unique). */
  id: string
  /** ISO date the item shipped (YYYY-MM-DD) — drives ordering + the shown label. */
  date: string
  /** A short, benefit-led headline (sentence case, no trailing period). */
  title: string
  /** One calm line of detail — what changed and why it helps. */
  detail: string
}

/**
 * Newest first. These are the real recently-shipped items (the identity hub +
 * avatars, the Clay & Sky default, the Files/Terminal/Logs fixes, themes).
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: 'agents-hub',
    date: '2026-05-31',
    title: 'Your agent has a face',
    detail:
      'Every agent gets a portrait and a home: the new Agents hub lets you rename it, pick its avatar, and read its soul, memory, and skills, all in one place.',
  },
  {
    id: 'clay-sky-default',
    date: '2026-05-31',
    title: 'A warmer first look',
    detail:
      'Clay & Sky, a calm cool-slate theme, is now the default. Prefer something else? Switch any of the four themes in Settings or ⌘K.',
  },
  {
    id: 'workspace-fixes',
    date: '2026-05-30',
    title: 'Files, Terminal, and Logs, fixed',
    detail:
      'Files and Terminal now open on your real workspace root, and Logs parse cleanly: the operator surfaces you reach for actually work.',
  },
  {
    id: 'themes',
    date: '2026-05-29',
    title: 'Four color themes, switchable anywhere',
    detail: 'Pick a look in Settings or ⌘K: four themes, each with a light and dark variant.',
  },
]

/** How many entries Home shows in the collapsed "What's new" block. */
export const RECENT_CHANGELOG_LIMIT = 3

/** The latest few entries for the Home "What's new" block (newest first). */
export const RECENT_CHANGELOG: ChangelogEntry[] = CHANGELOG.slice(0, RECENT_CHANGELOG_LIMIT)

/** A short, locale-stable date label for an entry, e.g. "May 29". */
export function formatChangelogDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
