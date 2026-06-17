/**
 * Per-profile gateway routing — the multi-gateway switch.
 *
 * A stock `hermes gateway` binds ONE profile (HERMES_HOME) for its process
 * lifetime; hermes has no hot-reload. To switch agents WITHOUT restarting a
 * gateway, the deck runs one gateway PER profile on a distinct port and routes
 * chat to whichever profile is active. The active profile is the sticky
 * `<hermesHome>/active_profile` pointer (the same file the Profiles switch
 * writes), so a switch is an endpoint swap on the very next run — no restart.
 *
 * Where a profile's port comes from, in precedence order:
 *   1. `AGENT_DECK_GATEWAY_PORTS` (e.g. `default=8642,work=8643`) — an explicit
 *      operator override (what install.sh writes when it registers a per-profile
 *      gateway service).
 *   2. `HERMES_GATEWAY_URL` — a single relocated/remote gateway pins EVERY
 *      profile to it (the explicit single-gateway escape hatch; also how the
 *      hermetic mock/demo harnesses point the deck at an in-process gateway).
 *   3. The DEFAULT profile uses the already-resolved configured URL
 *      (`config.hermesGatewayUrl`, read from the root `~/.hermes/config.yaml`).
 *   4. A NAMED profile reads ITS OWN `config.yaml` `API_SERVER_PORT` — the
 *      natural place a second gateway's distinct port already lives. With no
 *      distinct port declared, it falls back to the configured URL (the deck has
 *      no evidence of a separate gateway, so it does not invent a port).
 *
 * This module is pure resolution plus a thin client cache; it never starts or
 * stops a gateway process (the deck runs against ANY stock hermes).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolveHermesApiKey } from '../config'
import { readActiveProfile, resolveProfileDir } from '../profiles/profilesReader'
import { GatewayClient, type GatewayClientLike } from './gatewayClient'

/**
 * Parse `AGENT_DECK_GATEWAY_PORTS` into a profile→port map. Format is a
 * comma-separated list of `profile=port` (or `profile:port`) pairs; blanks,
 * malformed pairs, and out-of-range ports are dropped (never throws).
 */
export function parseGatewayPortOverrides(raw: string | undefined): Map<string, number> {
  const map = new Map<string, number>()
  if (!raw) return map
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const sep = trimmed.includes('=') ? '=' : ':'
    const idx = trimmed.indexOf(sep)
    if (idx <= 0) continue
    const name = trimmed.slice(0, idx).trim()
    const port = Number(trimmed.slice(idx + 1).trim())
    if (!name) continue
    if (Number.isInteger(port) && port > 0 && port < 65536) map.set(name, port)
  }
  return map
}

/** Read `API_SERVER_PORT` from a profile's config.yaml; null when absent/garbled. */
function readApiServerPort(configPath: string): number | null {
  let parsed: unknown
  try {
    parsed = parseYaml(readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>).API_SERVER_PORT
    const port =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
    if (Number.isInteger(port) && port > 0 && port < 65536) return port
  }
  return null
}

export interface ResolveEndpointOptions {
  env: NodeJS.ProcessEnv
  hermesHome: string
  /** The already-resolved configured gateway URL (the default profile's gateway). */
  fallbackUrl: string
  /** Parsed AGENT_DECK_GATEWAY_PORTS overrides; defaults to none. */
  portOverrides?: Map<string, number>
}

/**
 * Resolve the gateway base URL for a single profile (see precedence in the
 * module header). Never throws — a malformed profile name resolves to the
 * configured fallback URL.
 */
export function resolveGatewayEndpointForProfile(
  profile: string,
  opts: ResolveEndpointOptions,
): string {
  const { env, hermesHome, fallbackUrl } = opts
  // 1. Explicit per-profile port override.
  const override = opts.portOverrides?.get(profile)
  if (override) return `http://127.0.0.1:${override}`
  // 2. A single relocated/remote gateway pins every profile.
  const fromEnv = env.HERMES_GATEWAY_URL?.trim()
  if (fromEnv) return fromEnv
  // 3. The default profile uses the configured (root-config-resolved) URL.
  if (profile === 'default') return fallbackUrl
  // 4. A named profile reads its OWN config.yaml port, else the configured URL.
  let profileDir: string
  try {
    profileDir = resolveProfileDir(hermesHome, profile)
  } catch {
    return fallbackUrl
  }
  const port = readApiServerPort(join(profileDir, 'config.yaml'))
  return port ? `http://127.0.0.1:${port}` : fallbackUrl
}

/** Resolve the bearer key for a profile: env/global wins, else the profile's own
 * config.yaml; the default profile uses the already-resolved fallback key. */
function resolveApiKeyForProfile(
  profile: string,
  opts: { env: NodeJS.ProcessEnv; hermesHome: string; fallbackApiKey: string | null },
): string | null {
  if (profile === 'default') return opts.fallbackApiKey
  let profileDir: string
  try {
    profileDir = resolveProfileDir(opts.hermesHome, profile)
  } catch {
    return opts.fallbackApiKey
  }
  return resolveHermesApiKey(opts.env, join(profileDir, 'config.yaml')) ?? opts.fallbackApiKey
}

export interface ActiveEndpointOptions {
  hermesHome: string
  fallbackUrl: string
  env?: NodeJS.ProcessEnv
}

/** Resolve the gateway endpoint of whatever profile is currently active. Used by
 * the health probe so it honestly reflects the active agent's gateway. */
export function resolveActiveGatewayEndpoint(opts: ActiveEndpointOptions): string {
  const env = opts.env ?? process.env
  const profile = readActiveProfile(opts.hermesHome)
  return resolveGatewayEndpointForProfile(profile, {
    env,
    hermesHome: opts.hermesHome,
    fallbackUrl: opts.fallbackUrl,
    portOverrides: parseGatewayPortOverrides(env.AGENT_DECK_GATEWAY_PORTS),
  })
}

export interface GatewayRouterDeps {
  hermesHome: string
  /** The configured gateway URL (default profile / single-gateway fallback). */
  fallbackUrl: string
  /** The configured gateway bearer key (default profile fallback). */
  fallbackApiKey: string | null
  env?: NodeJS.ProcessEnv
  /** Injectable active-profile reader (tests). Defaults to the sticky file read. */
  readActiveProfile?: (hermesHome: string) => string
  /** Injectable client factory (tests / mock). Defaults to a real GatewayClient. */
  createClient?: (cfg: {
    hermesGatewayUrl: string
    hermesApiKey: string | null
  }) => GatewayClientLike
}

/**
 * Resolves (and caches) the {@link GatewayClient} for the active profile. One
 * router backs the chat namespace; it reads the sticky active-profile pointer on
 * each resolve, so a profile switch routes the next run to that profile's gateway
 * with no restart. Clients are cached per ENDPOINT — two profiles that resolve to
 * the same gateway share one client.
 */
export class GatewayRouter {
  private readonly clients = new Map<string, GatewayClientLike>()
  private readonly env: NodeJS.ProcessEnv
  private readonly portOverrides: Map<string, number>
  private readonly readActive: (hermesHome: string) => string
  private readonly createClient: (cfg: {
    hermesGatewayUrl: string
    hermesApiKey: string | null
  }) => GatewayClientLike

  constructor(private readonly deps: GatewayRouterDeps) {
    this.env = deps.env ?? process.env
    this.portOverrides = parseGatewayPortOverrides(this.env.AGENT_DECK_GATEWAY_PORTS)
    this.readActive = deps.readActiveProfile ?? readActiveProfile
    this.createClient = deps.createClient ?? ((cfg) => new GatewayClient(cfg))
  }

  /** The sticky active profile name ("default" when none is set). */
  activeProfile(): string {
    return this.readActive(this.deps.hermesHome)
  }

  /** The gateway base URL for a profile. */
  endpointFor(profile: string): string {
    return resolveGatewayEndpointForProfile(profile, {
      env: this.env,
      hermesHome: this.deps.hermesHome,
      fallbackUrl: this.deps.fallbackUrl,
      portOverrides: this.portOverrides,
    })
  }

  /** The (cached) gateway client for a profile, keyed by its resolved endpoint. */
  clientFor(profile: string): GatewayClientLike {
    const endpoint = this.endpointFor(profile)
    const existing = this.clients.get(endpoint)
    if (existing) return existing
    const client = this.createClient({
      hermesGatewayUrl: endpoint,
      hermesApiKey: resolveApiKeyForProfile(profile, {
        env: this.env,
        hermesHome: this.deps.hermesHome,
        fallbackApiKey: this.deps.fallbackApiKey,
      }),
    })
    this.clients.set(endpoint, client)
    return client
  }

  /** Resolve the active profile, its endpoint, and its client in one call. */
  resolveActive(): { profile: string; endpoint: string; client: GatewayClientLike } {
    const profile = this.activeProfile()
    return { profile, endpoint: this.endpointFor(profile), client: this.clientFor(profile) }
  }
}
