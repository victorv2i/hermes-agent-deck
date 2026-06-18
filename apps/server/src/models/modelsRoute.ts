/**
 * Models BFF — `GET /api/agent-deck/models`.
 *
 * Reads FOUR stock hermes endpoints in PARALLEL via the shared
 * {@link DashboardClient} (which forwards the same-host session token) and maps
 * them into the feature-local {@link ModelsResponse} for the web Models surface:
 *
 *   GET /api/model/info       active model + resolved capabilities / context lengths
 *   GET /api/model/options    authenticated providers + their model lists (picker)
 *   GET /api/model/auxiliary  auxiliary task assignments (hermes signature slots)
 *   GET /api/providers/oauth  per-provider login status → drives the `usable` flag
 *
 * Every path here is proven to exist in stock hermes v0.15.2
 * (hermes_cli/web_server.py: /api/model/info @937, /api/model/options @1037,
 * /api/model/auxiliary @1055, /api/providers/oauth @1573). The retired
 * dashboard overlay's `/api/chat/model-state` is NOT used — it does not exist.
 *
 * It also exposes the ONE mutation this surface needs — a REAL cross-provider
 * switch — by proxying the stock `POST /api/model/set` (web_server.py:1099):
 *
 *   POST /api/agent-deck/model/set  body { provider, model } → stock echo
 *
 * It also exposes thin provider-OAuth BFF proxies under
 * `/api/agent-deck/provider-oauth`, forwarding stock dashboard OAuth calls
 * without implementing OAuth/PKCE/client-id logic in Agentdeck.
 *
 * The dashboard session token is handled entirely inside the client and is never
 * surfaced here.
 *
 * Graceful degrade: `info` is required (a total failure → 502). `options`,
 * `auxiliary`, and `oauth` are best-effort — if any fails we still return the
 * active model and its capabilities. When the oauth probe is unavailable we fail
 * OPEN (`usable: true` for every model) so the picker still lists configured
 * providers rather than disabling everything off a transient probe error.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { DashboardClient } from '../hermes/dashboardClient'
import type {
  AuxiliaryTask,
  ModelCapabilities,
  ModelEntry,
  ModelsResponse,
  ProviderRef,
} from './types'

/** Raw `GET /api/model/info` shape (only fields we consume). */
interface RawModelInfo {
  model?: unknown
  provider?: unknown
  auto_context_length?: unknown
  config_context_length?: unknown
  effective_context_length?: unknown
  capabilities?: {
    supports_tools?: unknown
    supports_vision?: unknown
    supports_reasoning?: unknown
    context_window?: unknown
    max_output_tokens?: unknown
    model_family?: unknown
  }
}

/** Raw `GET /api/model/options` provider row. `models` is a list of id strings. */
interface RawProviderRow {
  slug?: unknown
  name?: unknown
  is_current?: unknown
  models?: unknown
  source?: unknown
}
interface RawModelOptions {
  providers?: unknown
  model?: unknown
  provider?: unknown
}

/** Raw `GET /api/model/auxiliary` shape (only fields we consume). */
interface RawAuxTask {
  task?: unknown
  provider?: unknown
  model?: unknown
}
interface RawAuxiliary {
  tasks?: unknown
}

/** Raw `GET /api/providers/oauth` shape (only fields we consume). */
interface RawOAuthProvider {
  id?: unknown
  status?: { logged_in?: unknown }
}
interface RawOAuthProviders {
  providers?: unknown
}

export interface ModelsRouteOptions {
  /** Shared dashboard client (auth + token handling already wired). */
  dashboard: DashboardClient
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const providerOAuthFailure = {
  error: 'provider_oauth_dashboard_failed',
  message: 'Unable to reach the hermes dashboard for provider OAuth.',
} as const

function pathParam(params: unknown, key: string): string {
  if (!params || typeof params !== 'object') return ''
  const raw = (params as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

function providerOAuthPath(providerId: string, suffix = ''): string {
  return `/api/providers/oauth/${encodeURIComponent(providerId)}${suffix}`
}

async function deleteDashboardJson(dashboard: DashboardClient, path: string): Promise<unknown> {
  const res = await dashboard.authedFetch(path, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`DELETE ${path} failed`)
  const text = await res.text()
  if (text.trim() === '') return {}
  return JSON.parse(text) as unknown
}

/** Map `info.capabilities` + context lengths into the feature capabilities shape. */
function mapCapabilities(info: RawModelInfo): ModelCapabilities {
  const caps = info.capabilities ?? {}
  return {
    supportsTools: bool(caps.supports_tools),
    supportsVision: bool(caps.supports_vision),
    supportsReasoning: bool(caps.supports_reasoning),
    contextWindow: num(caps.context_window),
    maxOutputTokens: num(caps.max_output_tokens),
    modelFamily: str(caps.model_family),
    autoContextLength: num(info.auto_context_length),
    configContextLength: num(info.config_context_length),
    effectiveContextLength: num(info.effective_context_length),
  }
}

/**
 * Resolve the set of provider slugs that are USABLE right now from
 * `GET /api/providers/oauth` — those whose `status.logged_in` is true. Returns
 * `null` when the oauth payload is unavailable/garbled, signalling the caller to
 * FAIL OPEN (treat every model as usable rather than disabling all non-active
 * providers off a transient probe failure).
 */
function loggedInProviders(oauth: RawOAuthProviders | null): Set<string> | null {
  if (!oauth || !Array.isArray(oauth.providers)) return null
  const usable = new Set<string>()
  for (const p of oauth.providers as RawOAuthProvider[]) {
    const id = str(p?.id)
    if (id && p?.status && p.status.logged_in === true) usable.add(id)
  }
  return usable
}

/**
 * Flatten the `options.providers[]` rows (each a slug + `models` id list) into a
 * flat {@link ModelEntry} list, flagging the single active model and tagging each
 * entry's `usable` + provider-qualified `qualifiedId`.
 *
 * `usableProviders` is the set of logged-in provider slugs from oauth, or `null`
 * to fail OPEN (every model usable). The active provider is ALWAYS usable.
 */
function mapModels(
  options: RawModelOptions | null,
  activeModelId: string,
  activeProviderId: string,
  usableProviders: Set<string> | null,
): ModelEntry[] {
  const isUsable = (slug: string, source: string): boolean => {
    if (usableProviders === null) return true // fail open (oauth unavailable)
    if (slug === activeProviderId) return true // the running provider is always usable
    if (usableProviders.has(slug)) return true // an OAuth-logged-in provider
    // A 'hermes' source = the provider is CONFIGURED in the user's Hermes (a stored
    // credential — OAuth OR api-key). The /api/providers/oauth probe only reports
    // OAUTH logins, so an api-key-connected provider (e.g. Nous via
    // `hermes auth add nous --type api-key`) would otherwise read not-usable even
    // though its models work. 'built-in'/'static' = unconfigured catalog rows.
    return source === 'hermes'
  }
  const rows = Array.isArray(options?.providers) ? (options!.providers as RawProviderRow[]) : []
  const entries: ModelEntry[] = []
  let hasActive = false
  for (const row of rows) {
    const slug = str(row?.slug)
    if (!slug) continue
    const source = str(row?.source) || 'static'
    const isCurrentProvider = bool(row?.is_current) || slug === activeProviderId
    const modelIds = Array.isArray(row?.models) ? (row!.models as unknown[]) : []
    for (const raw of modelIds) {
      const id = str(raw)
      if (!id) continue
      const active = !hasActive && isCurrentProvider && id === activeModelId
      if (active) hasActive = true
      entries.push({
        id,
        qualifiedId: `${slug}/${id}`,
        label: id,
        provider: slug,
        active,
        usable: isUsable(slug, source),
        source,
      })
    }
  }
  // If options didn't resolve (or omitted the active model), synthesize a single
  // entry from the active model so the page never renders empty when a model is
  // actually configured. The active model is always usable.
  if (!hasActive && activeModelId) {
    const provider = activeProviderId || 'unknown'
    entries.unshift({
      id: activeModelId,
      qualifiedId: `${provider}/${activeModelId}`,
      label: activeModelId,
      provider,
      active: true,
      usable: true,
      source: 'current',
    })
  }
  return entries
}

/** Map `auxiliary.tasks[]` into the feature shape (drop base_url; UI-irrelevant). */
function mapAuxiliary(auxiliary: RawAuxiliary | null): AuxiliaryTask[] {
  const tasks = Array.isArray(auxiliary?.tasks) ? (auxiliary!.tasks as RawAuxTask[]) : []
  return tasks
    .map((t) => ({ task: str(t?.task), provider: str(t?.provider), model: str(t?.model) }))
    .filter((t) => t.task !== '')
}

/**
 * Compose the feature contract from the stock payloads. `info` is required;
 * `options` / `auxiliary` / `oauth` may be null (best-effort) and degrade
 * gracefully. `oauth` drives the per-model `usable` flag (fail-open when null).
 */
export function mapModelsResponse(
  info: RawModelInfo,
  options: RawModelOptions | null,
  auxiliary: RawAuxiliary | null,
  oauth: RawOAuthProviders | null,
): ModelsResponse {
  const activeModelId = str(info.model)
  const providerId = str(info.provider)
  // The provider label lives on the matching options row (`name`); fall back to
  // the bare provider id when options didn't resolve or has no matching row.
  let providerLabel = providerId
  if (Array.isArray(options?.providers)) {
    for (const row of options!.providers as RawProviderRow[]) {
      if (str(row?.slug) === providerId) {
        providerLabel = str(row?.name) || providerId
        break
      }
    }
  }
  const provider: ProviderRef = { id: providerId, label: providerLabel }

  // `null` from loggedInProviders means the oauth probe was unavailable/garbled →
  // we fail OPEN (every model usable) but must SIGNAL that provider status is
  // unverified so the UI can warn rather than silently lie.
  const usableProviders = loggedInProviders(oauth)
  return {
    activeModelId,
    provider,
    models: mapModels(options, activeModelId, providerId, usableProviders),
    capabilities: mapCapabilities(info),
    auxiliary: mapAuxiliary(auxiliary),
    providerStatusUnknown: usableProviders === null,
  }
}

/**
 * Fastify plugin. Mount with no prefix (paths are absolute):
 *   await app.register(registerModelsRoutes, { dashboard })
 */
export const registerModelsRoutes: FastifyPluginAsync<ModelsRouteOptions> = async (
  app: FastifyInstance,
  opts: ModelsRouteOptions,
) => {
  const { dashboard } = opts

  app.get(
    '/api/agent-deck/models',
    async (_req, reply): Promise<ModelsResponse | { error: string }> => {
      // Fetch all four concurrently. `info` is required; `options`/`auxiliary`/
      // `oauth` are best-effort and resolve to null on failure (graceful degrade;
      // oauth=null → usable fails OPEN so the picker still lists providers).
      const [infoResult, options, auxiliary, oauth] = await Promise.all([
        dashboard.getJson<RawModelInfo>('/api/model/info').then(
          (v) => ({ ok: true as const, value: v }),
          () => ({ ok: false as const, value: null }),
        ),
        dashboard.getJson<RawModelOptions>('/api/model/options').catch(() => null),
        dashboard.getJson<RawAuxiliary>('/api/model/auxiliary').catch(() => null),
        dashboard.getJson<RawOAuthProviders>('/api/providers/oauth').catch(() => null),
      ])

      if (!infoResult.ok) {
        // Total failure: even the required model info is unreachable. The
        // DashboardError message is already scrubbed of the session token by the
        // client, but we still return a generic message to the browser.
        reply.code(502)
        return { error: 'Unable to reach the hermes dashboard for model info.' }
      }

      return mapModelsResponse(infoResult.value, options, auxiliary, oauth)
    },
  )

  // ── Cross-provider switch (the ONE mutation) ──
  // POST /api/agent-deck/model/set  body { provider, model,
  // confirmExpensiveModel? } → proxies the stock POST /api/model/set
  // (web_server.py:1099). Validates provider+model are non-empty strings BEFORE
  // any dashboard call (fail-closed). `confirmExpensiveModel: true` forwards as
  // the stock `confirm_expensive_model` flag — the user's explicit answer to the
  // gateway's expensive-model guard (which otherwise replies 200 +
  // `{ ok: false, confirm_required: true, confirm_message }` instead of
  // switching; that body passes through verbatim so the web layer can surface
  // it). A dashboard failure surfaces as a generic 502 (never raw stderr / the
  // token).
  app.post('/api/agent-deck/model/set', async (req, reply): Promise<unknown> => {
    const body = req.body as {
      provider?: unknown
      model?: unknown
      confirmExpensiveModel?: unknown
    } | null
    const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
    const model = typeof body?.model === 'string' ? body.model.trim() : ''
    if (provider === '' || model === '') {
      reply.code(400)
      return { error: 'Body must be { provider: string, model: string }.' }
    }
    try {
      return await dashboard.postJson<unknown>('/api/model/set', {
        provider,
        model,
        // Only an explicit true rides through; the guard stays in force otherwise.
        ...(body?.confirmExpensiveModel === true ? { confirm_expensive_model: true } : {}),
      })
    } catch {
      reply.code(502)
      return { error: 'Unable to switch the model on the hermes dashboard.' }
    }
  })

  // ── Provider OAuth dashboard proxies ──
  // Thin BFF pass-throughs for stock dashboard OAuth routes. Agentdeck validates
  // only route params and never implements OAuth/PKCE/token storage itself.
  app.get('/api/agent-deck/provider-oauth', async (_req, reply): Promise<unknown> => {
    try {
      return await dashboard.getJson<unknown>('/api/providers/oauth')
    } catch {
      reply.code(502)
      return providerOAuthFailure
    }
  })

  app.post('/api/agent-deck/provider-oauth/:providerId/start', async (req, reply) => {
    const providerId = pathParam(req.params, 'providerId')
    if (providerId === '') {
      reply.code(400)
      return { error: 'bad_request', message: 'providerId must be a non-empty string.' }
    }
    try {
      return await dashboard.postJson<unknown>(providerOAuthPath(providerId, '/start'), req.body)
    } catch {
      reply.code(502)
      return providerOAuthFailure
    }
  })

  app.post('/api/agent-deck/provider-oauth/:providerId/submit', async (req, reply) => {
    const providerId = pathParam(req.params, 'providerId')
    if (providerId === '') {
      reply.code(400)
      return { error: 'bad_request', message: 'providerId must be a non-empty string.' }
    }
    try {
      return await dashboard.postJson<unknown>(providerOAuthPath(providerId, '/submit'), req.body)
    } catch {
      reply.code(502)
      return providerOAuthFailure
    }
  })

  app.get(
    '/api/agent-deck/provider-oauth/:providerId/poll/:sessionId',
    async (req, reply): Promise<unknown> => {
      const providerId = pathParam(req.params, 'providerId')
      const sessionId = pathParam(req.params, 'sessionId')
      if (providerId === '' || sessionId === '') {
        reply.code(400)
        return {
          error: 'bad_request',
          message: 'providerId and sessionId must be non-empty strings.',
        }
      }
      try {
        return await dashboard.getJson<unknown>(
          providerOAuthPath(providerId, `/poll/${encodeURIComponent(sessionId)}`),
        )
      } catch {
        reply.code(502)
        return providerOAuthFailure
      }
    },
  )

  app.delete(
    '/api/agent-deck/provider-oauth/sessions/:sessionId',
    async (req, reply): Promise<unknown> => {
      const sessionId = pathParam(req.params, 'sessionId')
      if (sessionId === '') {
        reply.code(400)
        return { error: 'bad_request', message: 'sessionId must be a non-empty string.' }
      }
      try {
        return await deleteDashboardJson(
          dashboard,
          `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
        )
      } catch {
        reply.code(502)
        return providerOAuthFailure
      }
    },
  )

  app.delete('/api/agent-deck/provider-oauth/:providerId', async (req, reply) => {
    const providerId = pathParam(req.params, 'providerId')
    if (providerId === '') {
      reply.code(400)
      return { error: 'bad_request', message: 'providerId must be a non-empty string.' }
    }
    try {
      return await deleteDashboardJson(dashboard, providerOAuthPath(providerId))
    } catch {
      reply.code(502)
      return providerOAuthFailure
    }
  })
}
