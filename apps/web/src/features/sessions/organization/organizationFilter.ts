import type { Organization } from '@agent-deck/protocol'
import type { SessionSummary } from '../types'

/**
 * Pure composition logic for the sessions-pane organization layer: read a
 * session's project/tags from the store, count project membership over the
 * loaded rail, collect the tag universe, and filter a session list by an active
 * project/tag selection. All total + order-preserving so the rail's filtering
 * composes cleanly with search + pinned/recent grouping, and so it's trivially
 * unit-testable without a network or a component.
 *
 * The store is ADVISORY metadata over the read-only session list: an assignment
 * for a session id that isn't in the list is simply ignored (never invented as
 * a phantom row, never counted), matching the backend's no-orphan-cleanup model.
 */

/** The empty store shape (no projects, no assignments). */
export const EMPTY_ORGANIZATION: Organization = { projects: [], assignments: {} }

/**
 * The active organization filter. `projectId` scopes to one project ("All
 * sessions" = null); `tag` scopes to a single tag (null = any). Both compose:
 * when both are set a session must match BOTH. A single-tag filter (not a set)
 * keeps the active-filter UI a calm one-line affordance per the spec.
 */
export interface OrganizationFilter {
  projectId: string | null
  tag: string | null
}

/** The "nothing selected" filter — every session passes. */
export const NO_FILTER: OrganizationFilter = { projectId: null, tag: null }

/** Whether any organization filter is currently active. */
export function isFilterActive(filter: OrganizationFilter): boolean {
  return filter.projectId !== null || filter.tag !== null
}

/** The project id a session belongs to, or null. Tolerant of a missing entry. */
export function sessionProjectId(org: Organization, sessionId: string): string | null {
  return org.assignments[sessionId]?.projectId ?? null
}

/** A session's tags (already normalized lowercase by the server), or `[]`. */
export function sessionTags(org: Organization, sessionId: string): string[] {
  return org.assignments[sessionId]?.tags ?? []
}

/**
 * The sorted, de-duplicated union of every tag in the store — the suggestion
 * pool for the per-session "Tags…" affordance and the tag filter. Drawn from
 * ALL assignments (not just loaded sessions) so a tag you've used before is
 * suggestable even if that session isn't currently in the rail window.
 */
export function allTags(org: Organization): string[] {
  const set = new Set<string>()
  for (const entry of Object.values(org.assignments)) {
    for (const tag of entry.tags ?? []) set.add(tag)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * Count how many of the LOADED sessions belong to each project. Keyed by
 * project id; a project with no loaded sessions is absent (callers default to
 * 0). Orphan assignments (ids not in the list) never inflate a count.
 */
export function projectCounts(org: Organization, sessions: SessionSummary[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const pid = org.assignments[session.id]?.projectId
    if (pid) counts.set(pid, (counts.get(pid) ?? 0) + 1)
  }
  return counts
}

/**
 * Filter a session list by the active project/tag selection. Order-preserving
 * (it only removes), so it slots in BEFORE the existing search / pinned /
 * recent / date grouping without disturbing their ordering. A tag match is
 * case-insensitive against the normalized (lowercase) stored tags.
 */
export function applyOrganizationFilter(
  sessions: SessionSummary[],
  org: Organization,
  filter: OrganizationFilter,
): SessionSummary[] {
  if (!isFilterActive(filter)) return sessions
  const tag = filter.tag?.toLowerCase() ?? null
  return sessions.filter((session) => {
    const entry = org.assignments[session.id]
    if (filter.projectId !== null && entry?.projectId !== filter.projectId) return false
    if (tag !== null && !(entry?.tags ?? []).includes(tag)) return false
    return true
  })
}
