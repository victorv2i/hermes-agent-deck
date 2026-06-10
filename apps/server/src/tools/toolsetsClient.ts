/**
 * Feature-local client for the hermes dashboard's GATED toolsets endpoints:
 *   GET  /api/tools/toolsets         (web_server.py:5716) — list all toolsets
 *   PUT  /api/tools/toolsets/{name}  (web_server.py:5752) — enable/disable one
 *
 * Layers typed calls on top of the shared {@link DashboardClient} — the
 * session-token dance, same-host Origin, timeout, and 401-retry all live in the
 * dashboard client; this module maps raw payloads into the slim, whitelisted
 * shapes the BFF routes return.
 *
 * Dashboard contract for GET: `{ name, label, description, enabled, available,
 * configured, tools }` — we surface `name`, `label` (emoji stripped),
 * `description`, `enabled`, `configured`, and resolved `tools`; `available`
 * (mirrors `enabled`) is dropped. The session token is never surfaced.
 *
 * Dashboard contract for PUT: body `{ enabled: bool }`, response
 * `{ ok, name, enabled }`. The change persists to config.yaml
 * (`platform_toolsets.cli`) immediately, but the RUNNING gateway does NOT
 * re-read config until restart — callers must surface honest "restart to apply"
 * copy and never fake instant activation.
 */
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'

/** One configurable toolset as surfaced to the BFF route. */
export interface ToolsetSummary {
  name: string
  /** Friendly label with any leading emoji stripped (design spine: no emoji). */
  label: string
  description: string
  enabled: boolean
  configured: boolean
  tools: string[]
}

/** Raw dashboard toolset entry (only the fields we consume; others are dropped). */
interface RawToolset {
  name?: unknown
  label?: unknown
  description?: unknown
  enabled?: unknown
  configured?: unknown
  tools?: unknown
}

/**
 * The typed result of a toolset toggle (mirrors stock's response shape).
 * Exported so route-level tests can type-check the result.
 */
export interface ToolsetToggleResult {
  ok: boolean
  name: string
  enabled: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Strip a single leading emoji/symbol cluster + surrounding whitespace from a
 * stock label (e.g. "🔍 Web Search & Scraping" → "Web Search & Scraping"). Stock
 * labels prefix one pictographic glyph; the design spine forbids emoji in the UI,
 * so we drop it server-side. Falls back to the trimmed original when no leading
 * glyph is present, and never returns empty for a non-empty input.
 */
export function stripLeadingEmoji(label: string): string {
  // Remove leading run of non-ASCII-word, non-(latin letter/digit) characters:
  // pictographs, variation selectors, and any spacing after them. Anchored at
  // start so interior punctuation (e.g. "&") is preserved.
  const cleaned = label.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  return cleaned !== '' ? cleaned : label.trim()
}

/** Map one raw dashboard toolset into the slim summary, or null if it has no name. */
function mapToolset(raw: RawToolset): ToolsetSummary | null {
  const name = str(raw.name)
  if (!name) return null
  const label = stripLeadingEmoji(str(raw.label) || name)
  const tools = Array.isArray(raw.tools)
    ? raw.tools.filter((t): t is string => typeof t === 'string')
    : []
  return {
    name,
    label,
    description: str(raw.description),
    // The dashboard stamps `enabled`/`configured` as booleans; default to false
    // (the honest "off until proven on") on a malformed payload.
    enabled: raw.enabled === true,
    configured: raw.configured === true,
    tools,
  }
}

export class ToolsetsClient {
  constructor(private readonly dashboard: DashboardClient) {}

  /** List every configurable toolset (enabled/configured flags resolved). */
  async listToolsets(): Promise<ToolsetSummary[]> {
    const raw = await this.dashboard.getJson<unknown>('/api/tools/toolsets')
    if (!Array.isArray(raw)) {
      throw new DashboardError('toolsets response was not an array')
    }
    return (raw as RawToolset[]).map(mapToolset).filter((t): t is ToolsetSummary => t !== null)
  }

  /**
   * Enable or disable a named toolset for the `cli` platform.
   *
   * Proxies `PUT /api/tools/toolsets/{name}` (web_server.py:5752) with
   * `{ enabled }`. Returns the stock response `{ ok, name, enabled }`.
   *
   * The config is written immediately, but the RUNNING gateway re-reads config
   * only on restart. Callers must surface honest "restart to apply" copy.
   */
  async toggleToolset(name: string, enabled: boolean): Promise<ToolsetToggleResult> {
    const raw = await this.dashboard.putJson<unknown>(
      `/api/tools/toolsets/${encodeURIComponent(name)}`,
      { enabled },
    )
    if (
      raw === null ||
      typeof raw !== 'object' ||
      typeof (raw as Record<string, unknown>)['ok'] !== 'boolean'
    ) {
      throw new DashboardError('toolset toggle response has unexpected shape')
    }
    const r = raw as Record<string, unknown>
    return {
      ok: r['ok'] as boolean,
      name: typeof r['name'] === 'string' ? r['name'] : name,
      enabled: typeof r['enabled'] === 'boolean' ? r['enabled'] : enabled,
    }
  }
}
