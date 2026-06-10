/**
 * SkillsHubClient — thin wrapper over the hermes dashboard's skills-hub endpoints.
 *
 * Real stock routes (all verified against web_server.py):
 *   GET  /api/skills/hub/search?q=…&source=all&limit=20  (web_server.py:5390)
 *   POST /api/skills/hub/install   body { identifier }   (web_server.py:5350)
 *   POST /api/skills/hub/uninstall body { name }         (web_server.py:5367)
 *   POST /api/skills/hub/update    (no body)              (web_server.py:5380)
 *
 * All three POST mutations spawn a background action and return
 *   { ok: true, pid: <int>, name: <action-name> }.
 * The action status is polled via the stock:
 *   GET /api/actions/{name}/status  (web_server.py:1330)
 * where `name` is one of "skills-install" | "skills-uninstall" | "skills-update".
 *
 * The "restart to apply" behaviour is honest: skill install/uninstall require a
 * gateway restart — a real `hermes restart` — for the changes to take effect.
 * The BFF signals this with `restartRequired: true`; the UI shows an explicit note.
 */
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'

/** The action names that hub mutations can spawn (mirrors HubActionName in protocol). */
export type HubActionName = 'skills-install' | 'skills-uninstall' | 'skills-update'

/** One result from `GET /api/skills/hub/search`. */
export interface SkillHubResult {
  name: string
  description: string
  source: string
  identifier: string
  trust_level: string
  repo: string | null
  tags: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** One raw hub search result (only the fields we use). */
interface RawHubResult {
  name?: unknown
  description?: unknown
  source?: unknown
  identifier?: unknown
  trust_level?: unknown
  repo?: unknown
  tags?: unknown
}

function mapResult(raw: RawHubResult): SkillHubResult {
  return {
    name: str(raw.name),
    description: str(raw.description),
    source: str(raw.source),
    identifier: str(raw.identifier),
    trust_level: str(raw.trust_level),
    repo: typeof raw.repo === 'string' ? raw.repo : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
  }
}

export interface HubActionResult {
  ok: boolean
  /** The action name to poll via GET /api/actions/{name}/status. */
  action: HubActionName
  /**
   * Whether the caller should surface a "restart required" note.
   * Install + uninstall always require a gateway restart; update does not.
   */
  restartRequired: boolean
}

export class SkillsHubClient {
  constructor(private readonly dashboard: DashboardClient) {}

  /** Search the hub across all configured sources (web_server.py:5390). */
  async search(q: string, source = 'all', limit = 20): Promise<{ results: SkillHubResult[] }> {
    const params = new URLSearchParams({ q, source, limit: String(limit) })
    const raw = await this.dashboard.getJson<{ results?: unknown[] }>(
      `/api/skills/hub/search?${params}`,
    )
    const results: SkillHubResult[] = Array.isArray(raw?.results)
      ? (raw.results as RawHubResult[]).map(mapResult)
      : []
    return { results }
  }

  /** Install a skill by identifier (web_server.py:5350). */
  async install(identifier: string): Promise<HubActionResult> {
    const res = await this.dashboard.authedFetch('/api/skills/hub/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifier }),
    })
    if (!res.ok) {
      throw new DashboardError(
        `POST /api/skills/hub/install failed: HTTP ${res.status}`,
        res.status,
      )
    }
    return { ok: true, action: 'skills-install', restartRequired: true }
  }

  /** Uninstall a skill by name (web_server.py:5367). */
  async uninstall(name: string): Promise<HubActionResult> {
    const res = await this.dashboard.authedFetch('/api/skills/hub/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      throw new DashboardError(
        `POST /api/skills/hub/uninstall failed: HTTP ${res.status}`,
        res.status,
      )
    }
    return { ok: true, action: 'skills-uninstall', restartRequired: true }
  }

  /** Update all installed skills (web_server.py:5380). */
  async update(): Promise<HubActionResult> {
    const res = await this.dashboard.authedFetch('/api/skills/hub/update', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new DashboardError(`POST /api/skills/hub/update failed: HTTP ${res.status}`, res.status)
    }
    return { ok: true, action: 'skills-update', restartRequired: false }
  }

  /**
   * Poll a hub action's running state (web_server.py:1330).
   * `name` must be one of the hub action names; we call GET /api/actions/{name}/status.
   */
  async actionStatus(name: HubActionName): Promise<{
    running: boolean
    exit_code: number | null
    lines: string[]
  }> {
    const raw = await this.dashboard.getJson<{
      running?: unknown
      exit_code?: unknown
      lines?: unknown
    }>(`/api/actions/${name}/status`)
    return {
      running: raw?.running === true,
      exit_code: typeof raw?.exit_code === 'number' ? raw.exit_code : null,
      lines: Array.isArray(raw?.lines)
        ? (raw.lines as unknown[]).filter((l) => typeof l === 'string')
        : [],
    }
  }
}
