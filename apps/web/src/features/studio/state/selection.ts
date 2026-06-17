/**
 * Pure, serializable Studio selection state: the selected agent + the open
 * workbench section. No React, no fetch: these are the deterministic resolvers
 * the Studio uses to turn raw inputs (a deep-link param, a click, the live
 * roster) into a settled selection. Kept pure so the deep-link/redirect behavior
 * the spec calls for (`/profiles/:name` opens that agent; `/?agent=` works
 * cross-device) is unit-testable without rendering.
 */

/**
 * The Studio's top-level VIEWS — the page-level switch above the roster. `agents`
 * is the default (the roster + per-agent workbench); `connections` embeds the
 * GLOBAL Connections surface (voice / messaging / MCP / pairing / webhooks /
 * credentials), which applies to ALL agents, so it's a Studio-level view rather
 * than a per-agent workbench tab. Addressed by `?view=` so a deep link / the old
 * `/connections` redirect lands on the right view.
 */
export const STUDIO_VIEWS = ['agents', 'connections'] as const

export type StudioView = (typeof STUDIO_VIEWS)[number]

/** The view shown when none is requested (or the request is invalid). */
export const DEFAULT_STUDIO_VIEW: StudioView = 'agents'

/** Narrow an arbitrary value to a known {@link StudioView}. */
export function isStudioView(value: unknown): value is StudioView {
  return typeof value === 'string' && (STUDIO_VIEWS as readonly string[]).includes(value)
}

/** Resolve a requested view to a valid one, falling back to the default. */
export function resolveStudioView(requested: unknown): StudioView {
  return isStudioView(requested) ? requested : DEFAULT_STUDIO_VIEW
}

/**
 * The workbench sections, in the spec's order. A closed set so the UI renders a
 * known tab list and a deep-link section param is validated against it.
 */
export const STUDIO_SECTIONS = [
  'identity',
  'soul',
  'model',
  'tools',
  'memory',
  'skills',
  'env',
] as const

export type StudioSection = (typeof STUDIO_SECTIONS)[number]

/** The section shown when none is requested (or the request is invalid). */
export const DEFAULT_STUDIO_SECTION: StudioSection = 'identity'

/** Narrow an arbitrary value to a known {@link StudioSection}. */
export function isStudioSection(value: unknown): value is StudioSection {
  return typeof value === 'string' && (STUDIO_SECTIONS as readonly string[]).includes(value)
}

/** Resolve a requested section to a valid one, falling back to the default. */
export function resolveStudioSection(requested: unknown): StudioSection {
  return isStudioSection(requested) ? requested : DEFAULT_STUDIO_SECTION
}

/** Inputs for resolving which agent the workbench should open. */
export interface ResolveSelectedAgentInput {
  /** An explicit selection (a click or a deep-link `agent` param), or null. */
  selected: string | null | undefined
  /** The currently-active agent (Hermes `active_profile`). */
  active: string | null | undefined
  /** The live roster of agent names. */
  roster: readonly string[]
}

/**
 * Resolve the agent the workbench opens, in priority order:
 *  1. the explicit `selected` IF it exists in the roster (a valid deep link /
 *     click),
 *  2. otherwise the `active` agent IF it exists in the roster,
 *  3. otherwise the first roster entry,
 *  4. otherwise null (an empty roster, nothing to open).
 *
 * A `selected` (or `active`) name that is NOT in the roster is treated as stale
 * and skipped, so a deleted/renamed agent never leaves the workbench pointing at
 * a phantom. Matching is EXACT: Hermes profile names are case-sensitive.
 */
export function resolveSelectedAgent({
  selected,
  active,
  roster,
}: ResolveSelectedAgentInput): string | null {
  const has = (name: string | null | undefined): name is string =>
    typeof name === 'string' && roster.includes(name)
  if (has(selected)) return selected
  if (has(active)) return active
  return roster.length > 0 ? roster[0]! : null
}

/**
 * A fully-resolved Studio selection (agent + section). Serializable: it persists
 * cleanly to a URL/localStorage and round-trips through JSON.
 */
export interface StudioSelection {
  agent: string | null
  section: StudioSection
}

/**
 * A unique clone id derived from a source agent: `<source>-copy`, then
 * `<source>-copy-2`, `-3`, … until it doesn't collide with the live roster. Stays
 * within Hermes's profile-id charset (letters, numbers, - or _). Pure, so the
 * Studio's clone flow can pick a non-colliding name without a round trip.
 */
export function cloneName(source: string, existing: readonly string[]): string {
  const taken = new Set(existing)
  const base = `${source}-copy`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
