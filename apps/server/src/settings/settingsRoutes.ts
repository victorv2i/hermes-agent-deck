/**
 * Settings BFF route plugin.
 *
 * Exposes:
 *   GET  /api/agent-deck/config        — read-only, section-grouped, fully
 *                                        redacted view of the hermes config.
 *   POST /api/agent-deck/config/field  — a GUARDED single-field write for a short
 *                                        allowlist of safe, non-secret scalars.
 *
 * The GET composes the dashboard's `GET /api/config` (values) and
 * `GET /api/config/schema` (field metadata + category order) through the shared
 * {@link DashboardClient}, then hands both to {@link buildSettingsPayload}, which
 * redacts every credential before the response is serialized. Secret values never
 * reach the browser.
 *
 * The POST edits ONE allowlisted scalar (timezone / agent.max_turns) via a
 * read-modify-write against stock `PUT /api/config` (a full save). It reads the
 * UNREDACTED config, patches the one dot-path, and PUTs it back — so untouched
 * keys (incl. live credentials) round-trip verbatim. The redaction that protects
 * the GET is NEVER applied to this write body (a redacted secret would corrupt
 * the real credential). Everything off the allowlist stays read-only; the UI
 * shows an honest explanation + a deep-link rather than a control that can fail.
 *
 * Mount under no prefix (the path already includes `/api/agent-deck`).
 */
import type { FastifyPluginAsync } from 'fastify'
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'
import { buildSettingsPayload } from './settingsService'
import { applyConfigPatch, isWritableField, validateFieldValue } from './configWrite'
import type { DashboardConfigSchema, SettingsPayload } from './settingsTypes'

export interface SettingsRoutesOptions {
  /** Shared client for the loopback hermes dashboard (`:9123`). */
  dashboard: DashboardClient
}

export const registerSettingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { dashboard } = opts

  fastify.get('/api/agent-deck/config', async (_req, reply): Promise<SettingsPayload> => {
    try {
      // Fetch values + schema in parallel; both share the cached session token.
      const [config, schema] = await Promise.all([
        dashboard.getJson<unknown>('/api/config'),
        dashboard.getJson<DashboardConfigSchema>('/api/config/schema'),
      ])
      return buildSettingsPayload(config, schema)
    } catch (err) {
      // Surface a clean upstream-failure to the browser; never echo internals
      // (the DashboardClient already guarantees its messages carry no token).
      const status = err instanceof DashboardError ? 502 : 500
      reply.code(status)
      return {
        // The contract type is SettingsPayload, but on error we return a small
        // error envelope; cast through unknown so the handler stays typed for
        // the happy path while the error body is still valid JSON.
        error: 'Could not load configuration from the hermes dashboard.',
      } as unknown as SettingsPayload
    }
  })

  // GUARDED single-field write. Body: { key, value }. Only an allowlisted,
  // non-secret scalar may be written; everything else is refused before any
  // dashboard call. The write is a read-modify-write so untouched keys (incl.
  // credentials) round-trip verbatim.
  fastify.post('/api/agent-deck/config/field', async (req, reply) => {
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      return reply.code(400).send({ error: 'bad_request', message: 'Expected a JSON object.' })
    }
    const { key, value } = body as { key?: unknown; value?: unknown }
    if (typeof key !== 'string' || key === '') {
      return reply.code(400).send({ error: 'bad_request', message: 'A string `key` is required.' })
    }
    // Allowlist gate FIRST (before validation, before any dashboard call).
    if (!isWritableField(key)) {
      return reply
        .code(400)
        .send({ error: 'not_editable', message: `This field is not editable: ${key}` })
    }
    const validation = validateFieldValue(key, value)
    if (!validation.ok) {
      return reply.code(400).send({ error: 'invalid_value', message: validation.message })
    }

    try {
      // Read the FULL, UNREDACTED config, patch the one field, PUT it all back.
      const current = await dashboard.getJson<Record<string, unknown>>('/api/config')
      const next = applyConfigPatch(current, key, validation.value)
      await dashboard.putJson<unknown>('/api/config', { config: next })
      return reply.send({ ok: true, key, value: validation.value })
    } catch (err) {
      // Upstream (dashboard) failure. Never echo internals/token.
      const status = err instanceof DashboardError ? 502 : 500
      return reply
        .code(status)
        .send({ error: 'upstream_error', message: 'Could not save the configuration change.' })
    }
  })
}
