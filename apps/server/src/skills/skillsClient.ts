/**
 * Slim, feature-local client for the hermes dashboard's GATED skills endpoints
 * (`GET /api/skills` + `PUT /api/skills/toggle`). It layers ONLY the two typed
 * calls this surface needs on top of the shared {@link DashboardClient} — the
 * session-token dance, same-host Origin, timeout, and 401-retry all live in the
 * dashboard client; this module just maps the raw dashboard payload into the
 * slim, whitelisted shape the BFF route returns.
 *
 * We keep it as its own module (mirroring the statusClient split) so the skills
 * route never re-implements the dashboard mapping inline, and so a future field
 * change is a one-file edit. The session token is handled entirely inside the
 * dashboard client and is NEVER surfaced here.
 *
 * Dashboard contract (verified against hermes_cli/web_server.py
 * `GET /api/skills` → list of `{ name, description, category, enabled }`;
 * `PUT /api/skills/toggle` body `{ name, enabled }` → `{ ok, name, enabled }`).
 */
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'

/** One skill as surfaced to the BFF route. */
export interface SkillSummary {
  name: string
  description: string
  /** Leading path-segment category, or null for an uncategorized skill. */
  category: string | null
  enabled: boolean
}

/** Raw dashboard skill entry (only the fields we consume; others are dropped). */
interface RawSkill {
  name?: unknown
  description?: unknown
  category?: unknown
  enabled?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Map one raw dashboard skill into the slim summary, or null if it has no name. */
function mapSkill(raw: RawSkill): SkillSummary | null {
  const name = str(raw.name)
  if (!name) return null
  const category = typeof raw.category === 'string' && raw.category !== '' ? raw.category : null
  return {
    name,
    description: str(raw.description),
    category,
    // The dashboard always stamps `enabled`; default to true (visible == usable)
    // only if a malformed payload omits it, so a skill never reads as disabled
    // by accident.
    enabled: raw.enabled === false ? false : true,
  }
}

/** Build a `?profile=<name>` suffix for a valid profile name, else empty. */
function profileSuffix(profile?: string): string {
  return profile ? `?profile=${encodeURIComponent(profile)}` : ''
}

export class SkillsClient {
  constructor(private readonly dashboard: DashboardClient) {}

  /**
   * List every installed skill (enabled flag resolved). When `profile` is given,
   * the dashboard read is scoped to that profile via `?profile=` (stock
   * GET /api/skills accepts it); omitting it targets the active profile.
   */
  async listSkills(profile?: string): Promise<SkillSummary[]> {
    const raw = await this.dashboard.getJson<unknown>(`/api/skills${profileSuffix(profile)}`)
    if (!Array.isArray(raw)) {
      throw new DashboardError('skills response was not an array')
    }
    return (raw as RawSkill[]).map(mapSkill).filter((s): s is SkillSummary => s !== null)
  }

  /**
   * Enable or disable a skill by name. Returns the resolved `{ name, enabled }`.
   * Sends the dashboard's `PUT /api/skills/toggle` with the bearer token handled
   * by the shared client. When `profile` is given, it is sent as `body.profile`
   * so the toggle writes that profile's skills.disabled list (stock accepts it);
   * omitting it targets the active profile.
   */
  async toggleSkill(
    name: string,
    enabled: boolean,
    profile?: string,
  ): Promise<{ name: string; enabled: boolean }> {
    const res = await this.dashboard.authedFetch('/api/skills/toggle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(profile ? { name, enabled, profile } : { name, enabled }),
    })
    if (!res.ok) {
      throw new DashboardError(`PUT /api/skills/toggle failed: HTTP ${res.status}`, res.status)
    }
    const body = (await res.json().catch(() => null)) as {
      name?: unknown
      enabled?: unknown
    } | null
    // Trust our own request over a thin/absent echo so the optimistic client
    // always gets a definite resolved state.
    return {
      name: str(body?.name) || name,
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : enabled,
    }
  }
}
