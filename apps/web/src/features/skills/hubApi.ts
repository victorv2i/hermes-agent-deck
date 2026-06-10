/**
 * Skills Hub API client (web).
 *
 * Talks to the BFF skills hub endpoints, which proxy real stock hermes routes:
 *   GET  /api/agent-deck/skills/hub/search?q=…
 *   POST /api/agent-deck/skills/hub/install    { identifier }
 *   POST /api/agent-deck/skills/hub/uninstall  { name }
 *   POST /api/agent-deck/skills/hub/update
 *   GET  /api/agent-deck/skills/hub/action-status?name=…
 */
import { apiFetch, apiPost } from '@/lib/apiFetch'

export interface HubResult {
  name: string
  description: string
  source: string
  identifier: string
  trust_level: string
  repo: string | null
  tags: string[]
}

export interface HubSearchResponse {
  results: HubResult[]
}

export interface HubActionStarted {
  ok: boolean
  /** The action name to poll via /action-status. */
  action: string
  /** Whether a gateway restart is required to apply the change. */
  restartRequired: boolean
}

export interface HubActionStatus {
  running: boolean
  exit_code: number | null
  lines: string[]
}

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

function normalizeResult(raw: unknown): HubResult {
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    name: asString(obj.name),
    description: asString(obj.description),
    source: asString(obj.source),
    identifier: asString(obj.identifier),
    trust_level: asString(obj.trust_level),
    repo: typeof obj.repo === 'string' ? obj.repo : null,
    tags: Array.isArray(obj.tags) ? obj.tags.filter((t) => typeof t === 'string') : [],
  }
}

export async function searchHub(q: string, signal?: AbortSignal): Promise<HubSearchResponse> {
  const raw = await apiFetch<unknown>(
    `/skills/hub/search?q=${encodeURIComponent(q)}&source=all&limit=20`,
    { signal },
  )
  const obj = (raw ?? {}) as Record<string, unknown>
  const results = Array.isArray(obj.results) ? (obj.results as unknown[]).map(normalizeResult) : []
  return { results }
}

export async function installSkill(identifier: string): Promise<HubActionStarted> {
  const raw = await apiPost<unknown>('/skills/hub/install', { identifier })
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    ok: obj.ok === true,
    action: asString(obj.action, 'skills-install'),
    restartRequired: obj.restartRequired === true,
  }
}

export async function uninstallSkill(name: string): Promise<HubActionStarted> {
  const raw = await apiPost<unknown>('/skills/hub/uninstall', { name })
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    ok: obj.ok === true,
    action: asString(obj.action, 'skills-uninstall'),
    restartRequired: obj.restartRequired === true,
  }
}

export async function updateAllSkills(): Promise<HubActionStarted> {
  const raw = await apiPost<unknown>('/skills/hub/update', {})
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    ok: obj.ok === true,
    action: asString(obj.action, 'skills-update'),
    restartRequired: obj.restartRequired === true,
  }
}

export async function pollHubActionStatus(
  actionName: string,
  signal?: AbortSignal,
): Promise<HubActionStatus> {
  const raw = await apiFetch<unknown>(
    `/skills/hub/action-status?name=${encodeURIComponent(actionName)}`,
    { signal },
  )
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    running: obj.running === true,
    exit_code: typeof obj.exit_code === 'number' ? obj.exit_code : null,
    lines: Array.isArray(obj.lines)
      ? (obj.lines as unknown[]).filter((l) => typeof l === 'string')
      : [],
  }
}
