/**
 * Agent Studio BFF client. Every call authors ONE agent (a Hermes profile)
 * through Hermes's own per-profile dashboard API, which the agent-deck BFF
 * proxies. The selected agent is threaded as `profile` exactly the way the
 * Hermes contract expects (see {@link profileScope}): a `?profile=` query on the
 * scoped GETs, a `{ profile }` body fragment on the scoped writes, or a path
 * param on the per-profile profile routes. Omitting it targets the ACTIVE
 * profile.
 *
 * The BFF surface this codes against (the server's studio passthrough). Each
 * line is the SINGLE route the matching function calls (no per-agent write goes
 * through any other path):
 *   GET  /api/agent-deck/studio/config?profile=        -> StudioConfigSubset
 *   PUT  /api/agent-deck/studio/config {config,profile} -> { ok }
 *   GET  /api/agent-deck/studio/model-options?profile=  -> ModelOptionsResponse
 *   PUT  /api/agent-deck/profiles/:name/model {provider,model} -> { ok, provider, model }
 *   GET  /api/agent-deck/studio/profiles/:name/soul     -> { content, exists }
 *   PUT  /api/agent-deck/studio/profiles/:name/soul {content} -> { ok }
 *   GET  /api/agent-deck/studio/skills?profile=         -> { skills: StudioSkill[] }
 *   PUT  /api/agent-deck/studio/skills/toggle {name,enabled,profile} -> { name, enabled }
 *   GET  /api/agent-deck/studio/env?profile=            -> { env: { key, isSet }[] } (shape-only)
 *   PUT  /api/agent-deck/studio/env {key,value,profile} -> { ok } (value never echoed)
 *   POST /api/agent-deck/profiles {name,clone?,cloneFrom?,avatar?} -> { name }
 *   POST /api/agent-deck/profiles/switch {name}         -> { active }
 *
 * SECURITY: no secret value ever crosses BACK to the client. The env read is
 * normalized to {key, isSet} ONLY; any `redacted_value`/value the upstream
 * shape carries is dropped here (see {@link normalizeStudioEnv}). The env write
 * forwards the plaintext value to the BFF once and never stores or echoes it.
 *
 * Parsing: where the protocol package ships a Studio DTO (config subset, model
 * options, model set) we parse THROUGH it, so a partial/unexpected payload
 * throws a typed error at the boundary and out-of-subset config keys are
 * dropped. Soul uses the same defensive hand-normalization the rest of the web
 * app uses, keeping the surface tolerant of a thin payload.
 */
import {
  StudioConfigSubset,
  StudioConfigWriteResponse,
  ModelOptionsResponse,
  ProfileModelSetResponse,
  ProfileModelSetRequest,
  type StudioConfigWriteRequest,
  type RedactedEnvEntry,
  type StudioEnvResponse,
  type AvatarId,
} from '@agent-deck/protocol'
import { apiFetch, apiPost, API_BASE, ApiError } from '@/lib/apiFetch'
import { authHeaders } from '@/lib/authToken'
import { profileQuery, profileBody } from './profileScope'

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Read the selected agent's config SUBSET (model/toolsets/agent/memory). Parsed
 * through {@link StudioConfigSubset}, which DROPS every config key outside the
 * Studio's whitelist, so the surface never sees keys it does not author.
 */
export async function fetchStudioConfig(
  profile: string | null | undefined,
  signal?: AbortSignal,
): Promise<StudioConfigSubset> {
  const raw = await apiFetch<unknown>(`/studio/config${profileQuery(profile)}`, { signal })
  // The BFF wraps the subset in a `{ config }` envelope (studioRoute returns
  // `{ config: parsed.data }`). Unwrap it before parsing; without this every
  // key lands outside the all-optional subset and is dropped to {}, which
  // empties the Tools list and stalls the Memory section. A bare (unwrapped)
  // body is still accepted so the client tolerates either server shape.
  const body = asRecord(raw)
  const subset = 'config' in body ? body.config : raw
  return StudioConfigSubset.parse(subset)
}

/**
 * Write a PARTIAL config patch (only the keys the user changed) to the selected
 * agent. The profile rides in the body; omitted for the active profile. Hermes
 * normalizes keys, locks, and routes any secret to .env on its side.
 */
export async function writeStudioConfig(
  profile: string | null | undefined,
  config: StudioConfigWriteRequest['config'],
): Promise<StudioConfigWriteResponse> {
  const body = { ...profileBody(profile), config }
  const raw = await apiFetch<unknown>('/studio/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return StudioConfigWriteResponse.parse(raw)
}

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

/** Read the provider/model picker options for the selected agent. */
export async function fetchModelOptions(
  profile: string | null | undefined,
  signal?: AbortSignal,
): Promise<ModelOptionsResponse> {
  const raw = await apiFetch<unknown>(`/studio/model-options${profileQuery(profile)}`, { signal })
  return ModelOptionsResponse.parse(raw)
}

/**
 * Set the selected agent's model+provider via the per-profile model route (the
 * agent name is the PATH param, not a query/body). Hermes clears stale
 * base_url/context_length on this path, so it is preferred over patching
 * the top-level `model` id through the config write.
 */
export async function setProfileModel(
  profile: string,
  provider: string,
  model: string,
): Promise<ProfileModelSetResponse> {
  // Validate the request shape before it leaves the client (both fields
  // non-empty), mirroring the stock route's own guard.
  const body = ProfileModelSetRequest.parse({ provider, model })
  const raw = await apiFetch<unknown>(`/profiles/${encodeURIComponent(profile)}/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return ProfileModelSetResponse.parse(raw)
}

/* -------------------------------------------------------------------------- */
/* Soul                                                                       */
/* -------------------------------------------------------------------------- */

/** A profile's SOUL.md content + whether it exists on disk. */
export interface SoulFile {
  content: string
  exists: boolean
}

/**
 * Read the selected agent's SOUL.md through hermes's per-profile API (the agent
 * name is the path param). The studio route proxies GET /api/profiles/{name}/soul
 * rather than reading a profile file directly, per the integration contract.
 */
export async function fetchSoul(profile: string, signal?: AbortSignal): Promise<SoulFile> {
  const raw = await apiFetch<unknown>(`/studio/profiles/${encodeURIComponent(profile)}/soul`, {
    signal,
  })
  const obj = asRecord(raw)
  return { content: asString(obj.content), exists: obj.exists === true }
}

/**
 * Persist the selected agent's SOUL.md through hermes's per-profile API. The
 * studio route proxies PUT /api/profiles/{name}/soul, so soul is authored via
 * hermes's own endpoint, not a bespoke profile-file write.
 */
export async function writeSoul(profile: string, content: string): Promise<{ ok: boolean }> {
  const raw = await apiFetch<unknown>(`/studio/profiles/${encodeURIComponent(profile)}/soul`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return { ok: asRecord(raw).ok === true }
}

/* -------------------------------------------------------------------------- */
/* Skills (per-agent, profile-scoped)                                         */
/* -------------------------------------------------------------------------- */

/** One skill as the Studio's Skills section sees it (name + toggle state). */
export interface StudioSkill {
  name: string
  description: string
  /** Leading path-segment category, or null for an uncategorized skill. */
  category: string | null
  enabled: boolean
}

/** Defensively normalize one raw skill entry, or null when it has no name. */
function normalizeStudioSkill(v: unknown): StudioSkill | null {
  const obj = asRecord(v)
  const name = asString(obj.name)
  if (!name) return null
  const category = typeof obj.category === 'string' && obj.category !== '' ? obj.category : null
  return {
    name,
    description: asString(obj.description),
    category,
    // The server stamps `enabled`; default to true (visible == usable) only if a
    // malformed payload omits it, so a skill never reads as disabled by accident.
    enabled: obj.enabled !== false,
  }
}

/**
 * Read the SELECTED agent's skills through hermes's per-profile API. The studio
 * route threads `?profile=` to hermes GET /api/skills and returns the resolved
 * enabled flag for THAT agent (stock /api/skills accepts the scope); omitting it
 * targets the active profile.
 */
export async function fetchStudioSkills(
  profile: string | null | undefined,
  signal?: AbortSignal,
): Promise<StudioSkill[]> {
  const raw = await apiFetch<unknown>(`/studio/skills${profileQuery(profile)}`, { signal })
  const skills = asRecord(raw).skills
  return Array.isArray(skills)
    ? skills.map(normalizeStudioSkill).filter((s): s is StudioSkill => s !== null)
    : []
}

/**
 * Enable/disable a skill for the SELECTED agent. The profile rides in the body so
 * the toggle writes THAT agent's `skills.disabled` list (stock /api/skills/toggle
 * accepts `body.profile`); omitting it targets the active profile. Resolves to the
 * confirmed `{ name, enabled }`.
 */
export async function toggleStudioSkill(
  profile: string | null | undefined,
  name: string,
  enabled: boolean,
): Promise<{ name: string; enabled: boolean }> {
  const raw = await apiFetch<unknown>('/studio/skills/toggle', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled, ...profileBody(profile) }),
  })
  const obj = asRecord(raw)
  return {
    name: asString(obj.name) || name,
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : enabled,
  }
}

/* -------------------------------------------------------------------------- */
/* Env (redacted, shape-only)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Project ANY upstream env payload to the Studio's shape-only contract
 * ({key, isSet}). Two upstream shapes are tolerated so the surface is robust to
 * which one the BFF serves:
 *   - the slim Studio array: `{ env: [{ key, isSet }] }`
 *   - the rich per-key record: `{ env: { KEY: { is_set, redacted_value, ... } } }`
 *
 * CRUCIALLY the rich shape's `redacted_value` (and any raw value) is DROPPED:
 * only `key` + `isSet` survive, so no secret material (not even a masked
 * preview) is retained client-side. A record entry with no `is_set` flag falls
 * back to "set when its (redacted) value is a non-empty string".
 */
export function normalizeStudioEnv(raw: unknown): StudioEnvResponse {
  const env = asRecord(raw).env

  if (Array.isArray(env)) {
    const entries: RedactedEnvEntry[] = []
    for (const item of env) {
      const obj = asRecord(item)
      const key = asString(obj.key)
      if (key) entries.push({ key, isSet: obj.isSet === true })
    }
    return { env: entries }
  }

  if (env !== null && typeof env === 'object') {
    const record = env as Record<string, unknown>
    const entries: RedactedEnvEntry[] = Object.keys(record).map((key) => {
      const meta = asRecord(record[key])
      const isSet =
        'is_set' in meta
          ? meta.is_set === true
          : typeof meta.redacted_value === 'string' && meta.redacted_value !== ''
      // Only key + isSet leave this function; value/preview are intentionally dropped.
      return { key, isSet }
    })
    return { env: entries }
  }

  return { env: [] }
}

/** Read which env keys are set for the selected agent (shape-only, never a value). */
export async function fetchStudioEnv(
  profile: string | null | undefined,
  signal?: AbortSignal,
): Promise<StudioEnvResponse> {
  // The profile-aware studio env route threads ?profile= to hermes GET /api/env
  // and returns the slim { key, isSet } shape. The pre-existing /env route ignores
  // the scope, so it would silently read the ACTIVE agent's keys for any selection.
  const raw = await apiFetch<unknown>(`/studio/env${profileQuery(profile)}`, { signal })
  return normalizeStudioEnv(raw)
}

/** The shape-only outcome of an env write. The value is NEVER returned. */
export interface SetEnvResult {
  ok: boolean
  key: string
  restartRequired: boolean
}

/**
 * Set an env var for the selected agent. The plaintext `value` is sent ONCE in
 * the request body, straight to the BFF, and is never persisted or echoed back.
 * The profile rides in the body; omitted for the active profile.
 */
export async function setStudioEnv(
  profile: string | null | undefined,
  key: string,
  value: string,
): Promise<SetEnvResult> {
  // The profile-aware studio env route forwards body.profile to hermes PUT
  // /api/env, so the secret lands on the SELECTED agent. The pre-existing /env
  // route drops the scope and would write to the ACTIVE agent instead.
  const raw = await apiFetch<unknown>('/studio/env', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // value goes to the BFF once; it is not stored or logged client-side.
    body: JSON.stringify({ key, value, ...profileBody(profile) }),
  })
  const obj = asRecord(raw)
  return {
    ok: obj.ok === true,
    key: asString(obj.key) || key,
    restartRequired: obj.restartRequired === true,
  }
}

/* -------------------------------------------------------------------------- */
/* Profiles: create+clone, switch                                             */
/* -------------------------------------------------------------------------- */

/** Input for creating an agent, optionally cloned from an existing one. */
export interface CreateStudioProfileInput {
  name: string
  /** Source agent to clone config.yaml/.env/SOUL.md/skills from. */
  cloneFrom?: string
  /** The new agent's built-in avatar id. */
  avatar?: AvatarId
}

/** The created agent (its name + optional avatar), as the BFF echoes it. */
export interface CreatedStudioProfile {
  name: string
  avatar?: AvatarId
}

/**
 * Create an agent. When `cloneFrom` is set, sends the clone flag + source so the
 * BFF runs Hermes's `--clone` (copies config/.env/SOUL.md/skills). Otherwise a
 * plain create. The created name is echoed back.
 */
export async function createStudioProfile(
  input: CreateStudioProfileInput,
): Promise<CreatedStudioProfile> {
  const body: Record<string, unknown> = { name: input.name }
  if (input.cloneFrom) {
    body.clone = true
    body.cloneFrom = input.cloneFrom
  }
  if (input.avatar) body.avatar = input.avatar
  const raw = await apiPost<unknown>('/profiles', body)
  const obj = asRecord(raw)
  const avatar = obj.avatar
  return {
    name: asString(obj.name) || input.name,
    ...(typeof avatar === 'string' ? { avatar: avatar as AvatarId } : {}),
  }
}

/**
 * Switch the active agent (writes Hermes's `active_profile`). This does NOT
 * restart the gateway, so callers must surface the honest "restart to apply"
 * note. Returns the now-active agent name.
 */
export async function switchActiveProfile(name: string): Promise<{ active: string }> {
  const raw = await apiPost<unknown>('/profiles/switch', { name })
  const obj = asRecord(raw)
  return { active: asString(obj.active) || name }
}

/* -------------------------------------------------------------------------- */
/* Profile export / import (the BFF shells out to `hermes profile export|import`) */
/* -------------------------------------------------------------------------- */

/**
 * Export an agent as a `.tar.gz` and trigger a browser download. The BFF streams
 * the archive hermes' CLI produces; hermes EXCLUDES credentials (`.env`,
 * `auth.json`) from the archive, so the download is a credential-free snapshot.
 *
 * apiFetch always parses JSON, so this uses a raw fetch (with the same auth
 * header) to read the binary body as a Blob and saves it via an object URL.
 */
export async function exportAgent(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(name)}/export`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) {
    // Surface the BFF's clean message (generic on failure; never raw stderr).
    let message = `Couldn't export ${name}.`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message ?? body.error ?? message
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(message, res.status)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.tar.gz`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Read a File as a base64 string (no data-URL prefix), for the import upload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Could not read the file.'))
        return
      }
      // result is a data URL ("data:...;base64,<payload>"); strip the prefix.
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Import an agent from a `.tar.gz` archive. The bytes are sent as base64 in the
 * JSON body (the BFF stages them to a temp file and runs `hermes profile import
 * <tmp> --name <name>`). Returns the created agent name.
 */
export async function importAgent(name: string, archiveBase64: string): Promise<{ name: string }> {
  const raw = await apiPost<unknown>('/profiles/import', { name, archive: archiveBase64 })
  const obj = asRecord(raw)
  return { name: asString(obj.name) || name }
}
