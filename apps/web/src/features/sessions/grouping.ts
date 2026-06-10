import type { SessionSummary } from './types'

/**
 * Group the session rail by recency — Today / Yesterday / Earlier — using
 * LOCAL-day boundaries (matching the user's perception of "today"), sorted
 * within each bucket by most-recent activity first. Empty buckets are dropped.
 * Timestamps are unix seconds.
 */

export type GroupLabel = 'Today' | 'Yesterday' | 'Earlier'

export interface SessionGroup {
  label: GroupLabel
  sessions: SessionSummary[]
}

/** Midnight (local) at the start of the day containing `ms`. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function groupSessions(
  sessions: SessionSummary[],
  now: number = Date.now(),
): SessionGroup[] {
  const todayStart = startOfLocalDay(now)
  const yesterdayStart = todayStart - 86_400_000

  const buckets: Record<GroupLabel, SessionSummary[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  }

  for (const session of sessions) {
    const ms = session.last_active * 1000
    if (ms >= todayStart) buckets.Today.push(session)
    else if (ms >= yesterdayStart) buckets.Yesterday.push(session)
    else buckets.Earlier.push(session)
  }

  const order: GroupLabel[] = ['Today', 'Yesterday', 'Earlier']
  return order
    .map((label) => ({
      label,
      sessions: buckets[label].sort((a, b) => b.last_active - a.last_active),
    }))
    .filter((g) => g.sessions.length > 0)
}

/**
 * Float the most-recently-active sessions into a dedicated "Recent" group that
 * sits ABOVE the date groups (the split-rail sessions pane shows it so the very
 * last few conversations are always one glance away, regardless of which day
 * boundary they fall on). Returns the recent slice (sorted most-recent first)
 * plus the remaining sessions, which the caller still date-groups as usual so a
 * session never appears twice. `limit <= 0` yields no Recent group.
 */
export function splitRecent(
  sessions: SessionSummary[],
  limit: number,
): { recent: SessionSummary[]; rest: SessionSummary[] } {
  if (limit <= 0 || sessions.length === 0) return { recent: [], rest: sessions }
  const byRecency = [...sessions].sort((a, b) => b.last_active - a.last_active)
  return { recent: byRecency.slice(0, limit), rest: byRecency.slice(limit) }
}

/** A coarse, calm relative-age label for a row (unix seconds). */
export function formatRelative(seconds: number, now: number = Date.now()): string {
  const deltaMs = now - seconds * 1000
  if (deltaMs < 60_000) return 'just now'
  const mins = Math.floor(deltaMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
