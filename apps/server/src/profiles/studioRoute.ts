/**
 * AGENT STUDIO BFF - the per-profile authoring surface.
 *
 * The Studio lets a user author everything about ONE hermes profile (an agent)
 * in a single surface. Every read/write here integrates through hermes's OWN
 * per-profile dashboard API, scoped by `?profile=<name>` (query) or
 * `body.profile`; an omitted profile targets the active one. The BFF NEVER
 * hand-writes a profile's config/model/skills/soul files - it proxies the API,
 * so hermes owns key normalization, locking, and routing secrets to `.env`.
 *
 * Routes (all under /api/agent-deck/studio except the path-scoped model/soul):
 *   GET  /api/agent-deck/studio/config?profile=        -> { config: StudioConfigSubset }
 *   PUT  /api/agent-deck/studio/config                 body StudioConfigWriteRequest -> { ok }
 *   GET  /api/agent-deck/studio/model-options?profile= -> ModelOptionsResponse
 *   PUT  /api/agent-deck/profiles/:name/model          body { provider, model } -> { ok, provider, model }
 *   GET  /api/agent-deck/studio/skills?profile=        -> { skills: SkillSummary[] }
 *   PUT  /api/agent-deck/studio/skills/toggle          body { name, enabled, profile? } -> { name, enabled }
 *   GET  /api/agent-deck/studio/env?profile=           -> { env: { key, isSet }[] }  (SHAPE ONLY)
 *   PUT  /api/agent-deck/studio/env                    body { key, value, profile? } -> { ok, key, restartRequired }
 *   GET  /api/agent-deck/studio/profiles/:name/soul    -> { content, exists }
 *   PUT  /api/agent-deck/studio/profiles/:name/soul    body { content } -> { ok }
 *
 * VERIFIED stock hermes routes (installed hermes, config schema v29):
 *   GET /api/config (web_server.py:2946), PUT /api/config (3512) - both ?profile= + body.profile
 *   GET /api/model/options (3079) - ?profile=
 *   PUT /api/profiles/{name}/model (9080) - path-scoped
 *   GET /api/skills (9209), PUT /api/skills/toggle (9222) - both ?profile= + body.profile
 *   GET /api/env (3525), PUT /api/env (3550) - both ?profile= + body.profile
 *   GET /api/profiles/{name}/soul (9035), PUT /api/profiles/{name}/soul (9046) - path-scoped
 *
 * SECURITY:
 *  - The config GET returns ONLY {@link StudioConfigSubset} (model/toolsets/agent/
 *    memory). parse() drops every other config key - including any secret-bearing
 *    key (model.api_key, auxiliary.*.api_key) - so secrets carved out of the merged
 *    config never reach the browser. The config PUT likewise parses the patch
 *    through the subset, so a secret-shaped key can never be smuggled into the
 *    config write path (it routes to .env via /api/env instead).
 *  - The env GET is SHAPE ONLY: { key, isSet }. Not even hermes's server-side
 *    redacted preview crosses the wire through this surface.
 *  - The env PUT forwards the plaintext value to hermes ONCE and drops it; the
 *    value is never logged, echoed, or stored in agent-deck state.
 *  - A profile name is attacker-influenced (query/body/path). It is validated
 *    against {@link ProfileName} (the same closed regex the profiles path guard
 *    enforces) BEFORE any dashboard call, so a hostile name (`../etc`, casing,
 *    control chars) is refused with a 400 and never reaches hermes.
 *
 * Mount with no prefix (paths already include /api/agent-deck):
 *   await app.register(registerStudioRoutes, { dashboard })
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import {
  StudioConfigSubset,
  StudioConfigWriteRequest,
  ModelOptionsResponse,
  ProfileModelSetRequest,
  StudioEnvResponse,
  isProfileId,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'
import { SkillsClient } from '../skills/skillsClient'

export interface StudioRouteOptions {
  /** Shared dashboard client (auth + token handling already wired). */
  dashboard: DashboardClient
}

/** Map a dashboard failure (or any thrown error) to a clean 502, never leaking internals. */
function dashboardStatus(err: unknown): number {
  return err instanceof DashboardError ? 502 : 500
}

/**
 * Build a `?profile=<name>` suffix for a GET path, validating the
 * (attacker-influenced) name FIRST. Returns:
 *  - `{ ok: true, query: '' }` when no profile is requested (target the active one),
 *  - `{ ok: true, query: '?profile=<encoded>' }` for a valid name,
 *  - `{ ok: false }` for a syntactically invalid name (the caller 400s before any call).
 */
function profileQuery(
  raw: unknown,
): { ok: true; query: string; name: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, query: '', name: null }
  }
  if (typeof raw !== 'string' || !isProfileId(raw)) return { ok: false }
  return { ok: true, query: `?profile=${encodeURIComponent(raw)}`, name: raw }
}

/** A single optional profile field for a write body, validated. Mirrors profileQuery. */
function profileField(raw: unknown): { ok: true; profile?: string } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true }
  if (typeof raw !== 'string' || !isProfileId(raw)) return { ok: false }
  return { ok: true, profile: raw }
}

const BAD_PROFILE = { error: 'bad_request', message: 'profile must be a valid agent name' } as const

export const registerStudioRoutes: FastifyPluginAsync<StudioRouteOptions> = async (
  app: FastifyInstance,
  opts: StudioRouteOptions,
) => {
  const { dashboard } = opts
  const skills = new SkillsClient(dashboard)

  /* ───────────────────────────── CONFIG ───────────────────────────── */

  // GET the per-profile config SUBSET the Studio reads. Secrets in the raw merged
  // config are dropped by the subset parse - they never reach the browser.
  app.get<{ Querystring: { profile?: string } }>(
    '/api/agent-deck/studio/config',
    async (req, reply) => {
      const scope = profileQuery(req.query?.profile)
      if (!scope.ok) return reply.code(400).send(BAD_PROFILE)
      try {
        const raw = await dashboard.getJson<unknown>(`/api/config${scope.query}`)
        // The subset whitelist IS the redaction: parse() keeps only
        // model/toolsets/agent/memory and drops every secret-bearing key.
        const parsed = StudioConfigSubset.safeParse(raw)
        if (!parsed.success) {
          req.log.warn({ reason: parsed.error.message }, 'studio config subset parse failed')
          return reply
            .code(502)
            .send({ error: 'unreadable', message: 'Could not read agent config.' })
        }
        return reply.send({ config: parsed.data })
      } catch (err) {
        req.log.warn({ err }, 'studio config fetch failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not load the agent config.' })
      }
    },
  )

  // PUT a PARTIAL config patch (subset keys only) scoped to a profile. The patch
  // is parsed through the subset so a secret-shaped key can never be smuggled in.
  app.put<{ Body: unknown }>('/api/agent-deck/studio/config', async (req, reply) => {
    const parsed = StudioConfigWriteRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'A { config, profile? } body is required.' })
    }
    const { profile, config } = parsed.data
    try {
      // Forward the patch AND the profile; hermes normalizes keys, locks, and
      // routes any secret to .env on its side. body.profile scopes the target.
      await dashboard.putJson<unknown>('/api/config', profile ? { config, profile } : { config })
      return reply.send({ ok: true })
    } catch (err) {
      req.log.warn({ err }, 'studio config write failed')
      return reply
        .code(dashboardStatus(err))
        .send({ error: 'upstream_error', message: 'Could not save the agent config.' })
    }
  })

  /* ───────────────────────────── MODEL ───────────────────────────── */

  // GET the provider/model picker for a profile (the catalog + the profile's current).
  app.get<{ Querystring: { profile?: string } }>(
    '/api/agent-deck/studio/model-options',
    async (req, reply) => {
      const scope = profileQuery(req.query?.profile)
      if (!scope.ok) return reply.code(400).send(BAD_PROFILE)
      try {
        const raw = await dashboard.getJson<unknown>(`/api/model/options${scope.query}`)
        const parsed = ModelOptionsResponse.safeParse(raw)
        if (!parsed.success) {
          req.log.warn({ reason: parsed.error.message }, 'studio model-options parse failed')
          return reply
            .code(502)
            .send({ error: 'unreadable', message: 'Could not read the model options.' })
        }
        return reply.send(parsed.data)
      } catch (err) {
        req.log.warn({ err }, 'studio model-options fetch failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not load the model options.' })
      }
    },
  )

  // PUT the per-profile main model. Proxies hermes PUT /api/profiles/{name}/model,
  // which also clears stale base_url/context_length. The :name is path-guarded.
  app.put<{ Params: { name: string }; Body: unknown }>(
    '/api/agent-deck/profiles/:name/model',
    async (req, reply) => {
      const name = req.params.name
      if (!isProfileId(name)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'name must be a valid agent name' })
      }
      const parsed = ProfileModelSetRequest.safeParse(req.body)
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'provider and model are required' })
      }
      try {
        const result = await dashboard.putJson<{ ok?: boolean; provider?: string; model?: string }>(
          `/api/profiles/${encodeURIComponent(name)}/model`,
          { provider: parsed.data.provider, model: parsed.data.model },
        )
        return reply.send({
          ok: result?.ok ?? true,
          provider: result?.provider ?? parsed.data.provider,
          model: result?.model ?? parsed.data.model,
        })
      } catch (err) {
        req.log.warn({ err }, 'studio model set failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not set the agent model.' })
      }
    },
  )

  /* ───────────────────────────── SKILLS ───────────────────────────── */

  // GET the skill list for a profile (enabled flag resolved). Reuses the shared
  // SkillsClient mapping, scoped by ?profile=.
  app.get<{ Querystring: { profile?: string } }>(
    '/api/agent-deck/studio/skills',
    async (req, reply) => {
      const scope = profileQuery(req.query?.profile)
      if (!scope.ok) return reply.code(400).send(BAD_PROFILE)
      try {
        const list = await skills.listSkills(scope.name ?? undefined)
        return reply.send({ skills: list })
      } catch (err) {
        req.log.warn({ err }, 'studio skills fetch failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not load the agent skills.' })
      }
    },
  )

  // PUT a skill toggle scoped to a profile (writes the skills.disabled list).
  app.put<{ Body: unknown }>('/api/agent-deck/studio/skills/toggle', async (req, reply) => {
    const body = req.body
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'bad_request', message: 'A JSON body is required.' })
    }
    const { name, enabled, profile } = body as {
      name?: unknown
      enabled?: unknown
      profile?: unknown
    }
    if (typeof name !== 'string' || name === '' || typeof enabled !== 'boolean') {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'Body must be { name, enabled, profile? }.' })
    }
    const scope = profileField(profile)
    if (!scope.ok) return reply.code(400).send(BAD_PROFILE)
    try {
      const result = await skills.toggleSkill(name, enabled, scope.profile)
      return reply.send(result)
    } catch (err) {
      req.log.warn({ err }, 'studio skill toggle failed')
      return reply
        .code(dashboardStatus(err))
        .send({ error: 'upstream_error', message: 'Could not update the skill.' })
    }
  })

  /* ───────────────────────────── ENV (SHAPE ONLY) ───────────────────────────── */

  // GET which env keys are SET for a profile - SHAPE ONLY ({ key, isSet }). Neither
  // the value nor hermes's redacted preview crosses the wire through this surface.
  app.get<{ Querystring: { profile?: string } }>(
    '/api/agent-deck/studio/env',
    async (req, reply) => {
      const scope = profileQuery(req.query?.profile)
      if (!scope.ok) return reply.code(400).send(BAD_PROFILE)
      try {
        const raw = await dashboard.getJson<Record<string, unknown>>(`/api/env${scope.query}`)
        const env = Object.entries(raw ?? {}).map(([key, info]) => ({
          key,
          isSet: !!(info && typeof info === 'object' && (info as { is_set?: unknown }).is_set),
        }))
        // Parse through the slim contract so only { key, isSet } can ever surface.
        const parsed = StudioEnvResponse.safeParse({ env })
        if (!parsed.success) {
          req.log.warn({ reason: parsed.error.message }, 'studio env parse failed')
          return reply
            .code(502)
            .send({ error: 'unreadable', message: 'Could not read agent keys.' })
        }
        return reply.send(parsed.data)
      } catch (err) {
        req.log.warn({ err }, 'studio env fetch failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not load the agent keys.' })
      }
    },
  )

  // PUT an env key/value scoped to a profile. The plaintext value goes to hermes
  // ONCE and is dropped - never logged, echoed, or stored. Response is shape-only.
  app.put<{ Body: { key?: unknown; value?: unknown; profile?: unknown } }>(
    '/api/agent-deck/studio/env',
    async (req, reply) => {
      const { key, value, profile } = req.body ?? {}
      if (typeof key !== 'string' || key.trim() === '') {
        return reply.code(400).send({ error: 'bad_request', message: 'key (string) is required' })
      }
      if (typeof value !== 'string' || value.trim() === '') {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'value (non-empty string) is required' })
      }
      const scope = profileField(profile)
      if (!scope.ok) return reply.code(400).send(BAD_PROFILE)
      try {
        const res = await dashboard.authedFetch('/api/env', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          // The plaintext value goes directly to hermes and is never stored here.
          body: JSON.stringify(
            scope.profile
              ? { key: key.trim(), value, profile: scope.profile }
              : { key: key.trim(), value },
          ),
        })
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { detail?: string } | null
          const status = res.status === 400 ? 400 : 502
          return reply
            .code(status)
            .send({ error: 'hermes_error', message: errBody?.detail ?? 'Could not save the key.' })
        }
        // Shape-only - never echo the value. A write requires a gateway restart.
        return reply.send({ ok: true, key: key.trim(), restartRequired: true })
      } catch (err) {
        req.log.warn({ err }, 'studio env write failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not save the agent key.' })
      }
    },
  )

  /* ───────────────────────────── SOUL ───────────────────────────── */

  // GET a profile's SOUL.md via the hermes API (NOT a flat-file read). The :name
  // is path-guarded against the closed profile-name regex before any call.
  app.get<{ Params: { name: string } }>(
    '/api/agent-deck/studio/profiles/:name/soul',
    async (req, reply) => {
      const name = req.params.name
      if (!isProfileId(name)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'name must be a valid agent name' })
      }
      try {
        const raw = await dashboard.getJson<{ content?: unknown; exists?: unknown }>(
          `/api/profiles/${encodeURIComponent(name)}/soul`,
        )
        return reply.send({
          content: typeof raw?.content === 'string' ? raw.content : '',
          exists: raw?.exists === true,
        })
      } catch (err) {
        req.log.warn({ err }, 'studio soul fetch failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not load the agent soul.' })
      }
    },
  )

  // PUT a profile's SOUL.md via the hermes API. Validates a string content body.
  app.put<{ Params: { name: string }; Body: { content?: unknown } }>(
    '/api/agent-deck/studio/profiles/:name/soul',
    async (req, reply) => {
      const name = req.params.name
      if (!isProfileId(name)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'name must be a valid agent name' })
      }
      const content = req.body?.content
      if (typeof content !== 'string') {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'content (string) is required' })
      }
      try {
        await dashboard.putJson<unknown>(`/api/profiles/${encodeURIComponent(name)}/soul`, {
          content,
        })
        return reply.send({ ok: true })
      } catch (err) {
        req.log.warn({ err }, 'studio soul write failed')
        return reply
          .code(dashboardStatus(err))
          .send({ error: 'upstream_error', message: 'Could not save the agent soul.' })
      }
    },
  )
}
