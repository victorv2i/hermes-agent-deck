import { apiFetch, apiPost } from '@/lib/apiFetch'
import type {
  AuxiliaryTask,
  ModelCapabilities,
  ModelEntry,
  ModelsResponse,
  ProviderConnectResult,
  ProviderOAuthSession,
  ProviderRef,
} from './types'

/**
 * Fetch + defensively normalize the Models BFF payload
 * (`GET /api/agent-deck/models`). We hand-roll validation (no zod dependency in
 * this package) so a partial / unexpected payload degrades gracefully rather
 * than crashing the surface. The BFF composes this from three stock hermes
 * endpoints (`/api/model/{info,options,auxiliary}`).
 */

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const asBool = (v: unknown): boolean => v === true
const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}

const OAUTH_BASE = '/api/agent-deck/provider-oauth'

function normalizeProvider(v: unknown): ProviderRef {
  const obj = (v ?? {}) as Record<string, unknown>
  const id = asString(obj.id) || 'unknown'
  return { id, label: asString(obj.label) || id }
}

function normalizeModel(v: unknown, providerId: string): ModelEntry | null {
  const obj = (v ?? {}) as Record<string, unknown>
  const id = asString(obj.id)
  if (!id) return null
  const provider = asString(obj.provider) || providerId
  return {
    id,
    // Provider-qualified id (stable key); fall back to `<provider>/<id>` when an
    // older BFF payload omits it.
    qualifiedId: asString(obj.qualifiedId) || `${provider}/${id}`,
    label: asString(obj.label) || id,
    provider,
    active: asBool(obj.active),
    // Fail OPEN: a payload without `usable` (older BFF) is treated as usable so
    // the picker still lists the model; the real switch attempt is the boundary.
    usable: obj.usable === false ? false : true,
    source: asString(obj.source) || 'static',
  }
}

function normalizeCapabilities(v: unknown): ModelCapabilities {
  const obj = (v ?? {}) as Record<string, unknown>
  return {
    supportsTools: asBool(obj.supportsTools),
    supportsVision: asBool(obj.supportsVision),
    supportsReasoning: asBool(obj.supportsReasoning),
    contextWindow: asNumber(obj.contextWindow),
    maxOutputTokens: asNumber(obj.maxOutputTokens),
    modelFamily: asString(obj.modelFamily),
    autoContextLength: asNumber(obj.autoContextLength),
    configContextLength: asNumber(obj.configContextLength),
    effectiveContextLength: asNumber(obj.effectiveContextLength),
  }
}

function normalizeAuxiliary(v: unknown): AuxiliaryTask[] {
  if (!Array.isArray(v)) return []
  return v
    .map((t) => {
      const obj = (t ?? {}) as Record<string, unknown>
      return {
        task: asString(obj.task),
        provider: asString(obj.provider),
        model: asString(obj.model),
      }
    })
    .filter((t) => t.task !== '')
}

export function normalizeModelsResponse(raw: unknown): ModelsResponse {
  const obj = (raw ?? {}) as Record<string, unknown>
  const provider = normalizeProvider(obj.provider)
  const models = Array.isArray(obj.models)
    ? obj.models
        .map((m) => normalizeModel(m, provider.id))
        .filter((m): m is ModelEntry => m !== null)
    : []
  return {
    activeModelId: asString(obj.activeModelId),
    provider,
    models,
    capabilities: normalizeCapabilities(obj.capabilities),
    auxiliary: normalizeAuxiliary(obj.auxiliary),
    // Only `true` when the BFF explicitly reports it couldn't verify provider
    // status; any other shape (incl. older payloads omitting it) defaults false.
    providerStatusUnknown: obj.providerStatusUnknown === true,
  }
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelsResponse> {
  return normalizeModelsResponse(await apiFetch<unknown>('/models', { signal }))
}

/**
 * Connect a provider by API key via the LIVE setup BFF route
 * (`POST /api/agent-deck/setup/provider-key` → `hermes auth add <provider>
 * --api-key`). The key is a live secret: it is sent ONLY in this request body
 * and never persisted/echoed client-side — the response carries the provider +
 * a `connected` verdict, never the key. We use the absolute path (this route
 * lives under `/api/agent-deck/setup`, not the models base). On any non-2xx the
 * shared `apiFetch` throws a typed `ApiError`, which the caller surfaces.
 */
export async function connectProvider(
  provider: string,
  apiKey: string,
): Promise<ProviderConnectResult> {
  const raw = await apiPost<unknown>('/api/agent-deck/setup/provider-key', { provider, apiKey })
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    provider: asString(obj.provider) || provider,
    connected: asBool(obj.connected),
  }
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

function normalizeOAuthStatus(obj: Record<string, unknown>): ProviderOAuthSession['status'] {
  if (obj.connected === true || obj.loggedIn === true || obj.logged_in === true) {
    return 'connected'
  }
  const raw = firstString(obj, ['status', 'state', 'result'])?.toLowerCase()
  if (!raw) return 'unknown'
  if (['connected', 'complete', 'completed', 'success', 'succeeded', 'authorized'].includes(raw)) {
    return 'connected'
  }
  if (['failed', 'failure', 'error', 'errored', 'denied', 'expired'].includes(raw)) {
    return 'failed'
  }
  if (['cancelled', 'canceled'].includes(raw)) return 'cancelled'
  if (['pending', 'waiting', 'started', 'in_progress', 'needs_user', 'device_code'].includes(raw)) {
    return 'pending'
  }
  return 'unknown'
}

function normalizePollIntervalMs(obj: Record<string, unknown>): number | undefined {
  const value =
    asNumber(obj.pollIntervalMs) ||
    asNumber(obj.poll_interval_ms) ||
    asNumber(obj.pollInterval) ||
    asNumber(obj.poll_interval) ||
    asNumber(obj.interval)
  if (value <= 0) return undefined
  // OAuth device-code intervals are often expressed in seconds; explicit *Ms
  // fields are already milliseconds.
  if (typeof obj.pollIntervalMs === 'number' || typeof obj.poll_interval_ms === 'number') {
    return Math.max(1000, value)
  }
  return Math.max(1000, value <= 30 ? value * 1000 : value)
}

export function normalizeProviderOAuthSession(
  raw: unknown,
  fallbackProvider: string,
): ProviderOAuthSession {
  const root = asRecord(raw)
  const obj = Object.keys(root).length > 0 ? { ...root, ...asRecord(root.session) } : root
  const sessionId = firstString(obj, [
    'sessionId',
    'session_id',
    'oauthSessionId',
    'oauth_session_id',
    'id',
  ])
  const status = normalizeOAuthStatus(obj)
  return {
    provider:
      firstString(obj, [
        'provider',
        'providerId',
        'provider_id',
        'providerSlug',
        'provider_slug',
      ]) || fallbackProvider,
    status: status === 'unknown' && sessionId ? 'pending' : status,
    sessionId,
    url: firstString(obj, [
      'url',
      'authUrl',
      'auth_url',
      'authorizationUrl',
      'authorization_url',
      'loginUrl',
      'login_url',
      'launchUrl',
      'launch_url',
    ]),
    verificationUri: firstString(obj, [
      'verificationUri',
      'verification_uri',
      'verificationUrl',
      'verification_url',
      'verificationUriComplete',
      'verification_uri_complete',
    ]),
    userCode: firstString(obj, ['userCode', 'user_code', 'code']),
    deviceCode: firstString(obj, ['deviceCode', 'device_code']),
    message: firstString(obj, ['message', 'description', 'error']),
    pollIntervalMs: normalizePollIntervalMs(obj),
  }
}

/**
 * Fetch the set of provider slugs Hermes can OAuth, from the live
 * `GET /api/agent-deck/provider-oauth` list (a proxy of stock
 * `/api/providers/oauth`). This is the SOURCE OF TRUTH for which providers
 * support browser sign-in: the connect dialog intersects it with the static
 * catalog so the oauth-capable set can't silently drift, and surfaces live
 * OAuth providers (qwen/minimax/codex/…) the catalog hasn't enumerated yet.
 *
 * Returns a lowercased set of provider ids. On any failure it returns an EMPTY
 * set — the dialog then falls back to the static catalog's declared methods, so
 * a probe outage never hides a provider the catalog already knows can OAuth.
 */
export async function fetchProviderOAuthProviders(signal?: AbortSignal): Promise<Set<string>> {
  const raw = await apiFetch<unknown>('/provider-oauth', { signal })
  const obj = asRecord(raw)
  const list = Array.isArray(obj.providers) ? obj.providers : []
  const ids = new Set<string>()
  for (const p of list) {
    const row = asRecord(p)
    const id = firstString(row, ['id', 'provider', 'providerId', 'provider_id', 'slug'])
    if (id) ids.add(id.trim().toLowerCase())
  }
  return ids
}

/**
 * Start a Hermes-owned provider OAuth flow through the Agentdeck BFF. The
 * browser receives only launch/session metadata; provider tokens stay with
 * Hermes/BFF state and are not stored client-side.
 */
export async function startProviderOAuth(
  provider: string,
  signal?: AbortSignal,
): Promise<ProviderOAuthSession> {
  const raw = await apiFetch<unknown>(`${OAUTH_BASE}/${encodeURIComponent(provider)}/start`, {
    method: 'POST',
    signal,
  })
  return normalizeProviderOAuthSession(raw, provider)
}

export async function pollProviderOAuth(
  provider: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<ProviderOAuthSession> {
  const raw = await apiFetch<unknown>(
    `${OAUTH_BASE}/${encodeURIComponent(provider)}/poll/${encodeURIComponent(sessionId)}`,
    { signal },
  )
  return normalizeProviderOAuthSession(raw, provider)
}

export async function cancelProviderOAuth(sessionId: string, signal?: AbortSignal): Promise<void> {
  await apiFetch<unknown>(`${OAUTH_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    signal,
  })
}

/**
 * The honest outcome of a switch attempt. `confirm-required` is NOT an error:
 * the gateway's expensive-model guard answered 200 with
 * `{ ok: false, confirm_required: true, confirm_message }` INSTEAD of switching
 * — the model did not change, and the caller must put `confirmMessage` in front
 * of the user and re-call with `confirmExpensiveModel: true` only on an explicit
 * confirmation (never auto-confirm; the guard exists to stop accidental
 * expensive switches).
 */
export type SetModelResult =
  | { status: 'switched' }
  | { status: 'confirm-required'; confirmMessage: string }

/**
 * Switch the ACTIVE model/provider via the wave-0 BFF proxy of the stock
 * `POST /api/model/set` (`POST /api/agent-deck/model/set`, body `{ provider,
 * model, confirmExpensiveModel? }`). This is the REAL cross-provider switch —
 * picking a model whose provider differs from the running one must call this
 * BEFORE/with the run, or the pick silently no-ops (the run stays on the old
 * provider). On a gateway rejection `apiPost` throws a typed `ApiError` carrying
 * the BFF's honest message, which the caller surfaces as a toast — never a
 * silent failure. A 200 reply is INSPECTED, not assumed: the expensive-model
 * guard declines with `confirm_required` (see {@link SetModelResult}), and any
 * other `ok: false` throws rather than reading as a switch that never happened.
 */
export async function setActiveModel(
  provider: string,
  model: string,
  confirmExpensiveModel = false,
): Promise<SetModelResult> {
  const raw = await apiPost<unknown>('/api/agent-deck/model/set', {
    provider,
    model,
    ...(confirmExpensiveModel ? { confirmExpensiveModel: true } : {}),
  })
  const obj = asRecord(raw)
  if (obj.confirm_required === true) {
    return {
      status: 'confirm-required',
      confirmMessage:
        asString(obj.confirm_message) ||
        `${model} is priced well above typical models. Confirm to switch.`,
    }
  }
  if (obj.ok === false) {
    throw new Error(asString(obj.message) || 'The gateway declined the model switch.')
  }
  return { status: 'switched' }
}
