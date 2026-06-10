/**
 * Cross-source status BFF — `GET /api/agent-deck/status`.
 *
 * Proxies the hermes dashboard's PUBLIC `GET /api/status` (via the slim
 * {@link StatusClient}) and maps it to the SLIM, WHITELISTED
 * {@link AgentDeckStatus} DTO for the web "Active recently" band.
 *
 * SECURITY-CRITICAL: the raw `/api/status` payload ALSO carries filesystem
 * layout fields — env_path / config_path / hermes_home / module_path /
 * repo_path. A remote operator must NEVER learn the server's on-disk layout, so
 * this mapper reads ONLY the whitelisted fields below; every path field is
 * dropped here and the DTO type has no slot for them. (The protocol DTO test
 * also asserts the key set is exactly the whitelist.)
 *
 * Mount under no prefix (the path already includes `/api/agent-deck`).
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { AgentDeckStatus, type AgentDeckPlatform, type PlatformState } from '@agent-deck/protocol'
import type { StatusClient } from './statusClient'

export interface StatusRouteOptions {
  /** Slim client for the dashboard's public `/api/status`. */
  statusClient: StatusClient
}

/** Raw per-platform entry shape the dashboard reports (only consumed fields). */
interface RawPlatform {
  state?: unknown
  updated_at?: unknown
  error_code?: unknown
  error_message?: unknown
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Normalize the dashboard's free-form per-platform `state` into the governed
 * semantic set. The dashboard uses strings like "connected"/"running",
 * "degraded", "error"/"down"/"stopped"; anything unrecognized is "unknown" so
 * the band degrades honestly rather than inventing a green dot.
 */
function mapPlatformState(raw: unknown): PlatformState {
  const s = str(raw).toLowerCase()
  if (s === 'connected' || s === 'running' || s === 'ok' || s === 'active') return 'connected'
  if (s === 'degraded' || s === 'warning' || s === 'reconnecting') return 'degraded'
  if (s === 'down' || s === 'error' || s === 'stopped' || s === 'failed' || s === 'disconnected')
    return 'down'
  return 'unknown'
}

/** Map one raw platform entry; the platform NAME comes from the rollup key. */
function mapPlatform(name: string, raw: RawPlatform): AgentDeckPlatform {
  const state = mapPlatformState(raw.state)
  // Surface a short reason only when the state is non-healthy; prefer the human
  // message, fall back to the code. Never echo anything else from the entry.
  const message = str(raw.error_message) || str(raw.error_code) || null
  return {
    name,
    state,
    error: state === 'degraded' || state === 'down' ? message : null,
  }
}

/**
 * Map the raw dashboard `/api/status` payload to the slim whitelisted DTO. Only
 * the fields named here are read; filesystem paths are never touched. The result
 * is parsed through the protocol schema so a malformed upstream can't widen it.
 */
export function mapStatus(raw: Record<string, unknown>): AgentDeckStatus {
  const platformsRaw = raw.gateway_platforms
  const platforms: AgentDeckPlatform[] =
    platformsRaw && typeof platformsRaw === 'object'
      ? Object.entries(platformsRaw as Record<string, unknown>).map(([name, entry]) =>
          mapPlatform(name, (entry ?? {}) as RawPlatform),
        )
      : []

  const configVersion = num(raw.config_version)
  const latestConfigVersion = num(raw.latest_config_version)

  return AgentDeckStatus.parse({
    gatewayRunning: raw.gateway_running === true,
    gatewayState: str(raw.gateway_state),
    platforms,
    activeSessions: num(raw.active_sessions),
    version: str(raw.version),
    // A config update is available when the running version trails the latest.
    // Only flag it when both are present (>0) and strictly ordered, so a payload
    // missing either field never raises a false hint.
    configUpdateAvailable:
      latestConfigVersion > 0 && configVersion > 0 && configVersion < latestConfigVersion,
  })
}

/**
 * Fastify plugin. Mount with no prefix (path is absolute):
 *   await app.register(registerStatusRoutes, { statusClient })
 */
export const registerStatusRoutes: FastifyPluginAsync<StatusRouteOptions> = async (
  app: FastifyInstance,
  opts: StatusRouteOptions,
) => {
  const { statusClient } = opts

  app.get(
    '/api/agent-deck/status',
    async (_req, reply): Promise<AgentDeckStatus | { error: string }> => {
      try {
        const raw = await statusClient.getStatus()
        return mapStatus(raw)
      } catch {
        // Any dashboard failure (unreachable, non-2xx, bad payload) surfaces as a
        // generic 502 — never echo internals.
        reply.code(502)
        return { error: 'Unable to reach the hermes dashboard for cross-source status.' }
      }
    },
  )
}
