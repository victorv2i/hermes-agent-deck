/**
 * Profile-scoping helpers: the ONE place that turns the Studio's selected agent
 * into the `profile` the Hermes per-profile dashboard API expects. Every Studio
 * read/write scopes its target this way: a `?profile=` query for the GETs and
 * the routes that read it (config, model options, skills, env), a `{ profile }`
 * body fragment for the writes that read `body.profile` (config write, skill
 * toggle, env write).
 *
 * The contract (verified against installed Hermes, see the protocol's
 * agentStudio.ts): an OMITTED profile (or the literal `current`) targets the
 * ACTIVE profile. So a null/blank/`current` name produces no query and no body
 * key, which is exactly how a caller asks for "the active agent". Pure and
 * serializable: no fetch, no React, trivially testable.
 */

/** The sentinel Hermes treats as "the active profile" (same as omitting it). */
const ACTIVE_SENTINEL = 'current'

/**
 * Normalize a selected-agent name to the value worth scoping by, or null when
 * the call should target the active profile (null/blank/`current`).
 */
function normalize(profile: string | null | undefined): string | null {
  if (typeof profile !== 'string') return null
  const trimmed = profile.trim()
  if (trimmed === '' || trimmed.toLowerCase() === ACTIVE_SENTINEL) return null
  return trimmed
}

/**
 * The `?profile=<name>` query string for a scoped GET, or `''` to target the
 * active profile. The name is URL-encoded.
 */
export function profileQuery(profile: string | null | undefined): string {
  const name = normalize(profile)
  return name === null ? '' : `?profile=${encodeURIComponent(name)}`
}

/**
 * The `{ profile }` body fragment for a scoped write, or `{}` to target the
 * active profile. Spread into a request body: `{ ...profileBody(p), config }`.
 */
export function profileBody(profile: string | null | undefined): { profile?: string } {
  const name = normalize(profile)
  return name === null ? {} : { profile: name }
}
