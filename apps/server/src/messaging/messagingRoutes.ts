/**
 * MESSAGING HUB BFF — `/api/agent-deck/messaging`.
 *
 * Two routes, both thin faithful proxies over stock hermes (no new endpoints):
 *
 *   GET  /api/agent-deck/messaging
 *     Composes {@link MessagingState} = the static registry × the gateway's REAL
 *     per-platform connection truth (`GET /api/status`.gateway_platforms +
 *     gateway_running) × each token's SHAPE (`GET /api/env` is_set /
 *     redacted_value). Status is read via the slim public {@link StatusClient};
 *     env via the gated {@link DashboardClient}. The raw `/api/status` body ALSO
 *     carries filesystem-path fields — the composer reads ONLY the whitelisted
 *     fields, so no path ever reaches the browser.
 *
 *   POST /api/agent-deck/messaging/token
 *     Stores ONE platform bot token. The body is validated against
 *     {@link SetMessagingTokenRequest}, then the `(platform, envVar)` pair is
 *     ALLOWLISTED against the registry ({@link isRegistryToken}) — an env var not
 *     owned by a known messaging platform is refused BEFORE any dashboard call
 *     (no arbitrary env writes). On pass we proxy stock `PUT /api/env`
 *     (`{ key, value }`), then re-read `/api/env` and return the platform's
 *     refreshed SHAPE-ONLY fields with `restartRequired: true`.
 *
 * SECURITY: the plaintext token value is NEVER returned and NEVER logged. It is
 * read once from the request body, forwarded straight to stock `PUT /api/env`,
 * and dropped. The response carries only `is_set` + the redacted preview.
 *
 * We do NOT own the gateway restart here — the existing `/system` route
 * (`POST /api/gateway/restart`) already proxies it; this BFF only signals
 * `restartRequired: true` and the UI reuses that honest restart control.
 *
 * Mount under no prefix (the paths already include `/api/agent-deck`).
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  MessagingState,
  SetMessagingTokenRequest,
  type SetMessagingTokenResponse,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import type { StatusClient } from '../hermes/statusClient'
import { composeMessagingState, buildTokenFields } from './messagingService'
import { getRegistryEntry, isRegistryToken } from './registry'

export interface MessagingRoutesOptions {
  /** Gated client for the loopback hermes dashboard (GET/PUT /api/env). */
  dashboard: DashboardClient
  /** Slim public client for the dashboard's `/api/status` rollup. */
  statusClient: StatusClient
}

export const registerMessagingRoutes: FastifyPluginAsync<MessagingRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { dashboard, statusClient } = opts

  fastify.get('/api/agent-deck/messaging', async (_req, reply): Promise<MessagingState> => {
    try {
      // Status (public, token-less) + env (gated) in parallel.
      const [status, env] = await Promise.all([
        statusClient.getStatus(),
        dashboard.getJson<Record<string, unknown>>('/api/env'),
      ])
      return composeMessagingState(status, env)
    } catch {
      // Any upstream failure (unreachable, non-2xx, bad payload) → generic 502;
      // never echo internals (the clients already strip any token from messages).
      reply.code(502)
      return {
        error: 'Unable to reach the hermes dashboard for messaging state.',
      } as unknown as MessagingState
    }
  })

  // Store ONE platform bot token. Allowlist FIRST (before any dashboard call).
  fastify.post('/api/agent-deck/messaging/token', async (req, reply) => {
    const parsed = SetMessagingTokenRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Expected { platform, envVar, value } with a non-empty value.',
      })
    }
    const { platform, envVar, value } = parsed.data

    // ALLOWLIST GATE: the (platform, envVar) pair must be a known registry bot
    // token. Anything else — a non-token messaging var, a cross-platform pair, a
    // status-only platform, or an arbitrary env var — is refused with no write.
    if (!isRegistryToken(platform, envVar)) {
      return reply.code(400).send({
        error: 'not_a_messaging_token',
        message: `${envVar} is not a configurable token for ${platform}.`,
      })
    }

    const entry = getRegistryEntry(platform)!

    try {
      // Proxy stock PUT /api/env. The plaintext value flows straight through and
      // is never logged or retained here.
      await dashboard.putJson<unknown>('/api/env', { key: envVar, value })

      // Re-read /api/env so the response carries the REFRESHED shape-only fields
      // (is_set + redacted preview) for this platform — never the plaintext.
      const env = await dashboard.getJson<Record<string, unknown>>('/api/env')
      const response: SetMessagingTokenResponse = {
        platform,
        tokens: buildTokenFields(entry, env),
        restartRequired: true,
      }
      return reply.send(response)
    } catch {
      // Upstream (dashboard) failure. Never echo internals/token.
      return reply
        .code(502)
        .send({ error: 'upstream_error', message: 'Could not store the messaging token.' })
    }
  })
}
