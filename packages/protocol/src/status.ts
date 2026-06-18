import { z } from 'zod'

/**
 * Cross-source agent status — the SLIM, WHITELISTED view of the hermes
 * dashboard's `GET /api/status`. The dashboard knows the running gateway, its
 * per-platform connection states (telegram/cron/cli/…), an active-session count,
 * and config version drift. Agentdeck's own chat surface only sees the LOCAL
 * web run; this DTO is how the "Active recently" band learns that an operator is
 * also driving the agent from other sources.
 *
 * SECURITY-CRITICAL: the raw dashboard payload also carries filesystem layout
 * fields (env_path / config_path / hermes_home / module_path / repo_path). NONE
 * of them appear here — a remote operator must never learn the server's on-disk
 * layout. The BFF maps ONLY the fields below; this schema is the contract that
 * enforces it (anything not declared here cannot reach the client).
 */

/** A governed semantic state for a platform connection dot (NOT amber). */
export const PlatformState = z.enum(['connected', 'degraded', 'down', 'unknown'])
export type PlatformState = z.infer<typeof PlatformState>

export const AgentDeckPlatform = z.object({
  /** Platform name as reported by the gateway, e.g. "telegram", "cron", "cli". */
  name: z.string(),
  /** Governed connection state (see {@link PlatformState}). */
  state: PlatformState,
  /** A short human reason when degraded/down; null when healthy/unknown. */
  error: z.string().nullable(),
})
export type AgentDeckPlatform = z.infer<typeof AgentDeckPlatform>

export const AgentDeckStatus = z.object({
  /** Whether the hermes gateway process is up. */
  gatewayRunning: z.boolean(),
  /** The gateway's own coarse state string (e.g. "running", "stopped"). */
  gatewayState: z.string(),
  /** Per-platform connection rollup (telegram/cron/cli/…). */
  platforms: z.array(AgentDeckPlatform),
  /** Count of sessions the gateway considers active. */
  activeSessions: z.number(),
  /** The gateway version string (display only). */
  version: z.string(),
  /** True when the running config_version trails the latest available one. */
  configUpdateAvailable: z.boolean(),
})
export type AgentDeckStatus = z.infer<typeof AgentDeckStatus>
