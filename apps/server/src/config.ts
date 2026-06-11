import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { isLoopbackHost } from './auth/auth'

/** Hostnames that bind EVERY interface — refused unless AGENT_DECK_UNSAFE_BIND=1. */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', '*'])

/**
 * Is this bind host a broad wildcard (every interface)? A wildcard bind exposes
 * the server on every network the host can reach — far broader than a single
 * Tailscale name/IP — so it is refused unless the operator opts in explicitly.
 * IPv6 wildcards may arrive bracketed (`[::]`); compare both forms.
 */
export function isWildcardHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return WILDCARD_HOSTS.has(h) || WILDCARD_HOSTS.has(h.replace(/^\[/, '').replace(/\]$/, ''))
}

/** Thrown when a wildcard bind is requested without the explicit opt-in. */
export class UnsafeBindError extends Error {
  constructor(public readonly host: string) {
    super(
      `Refusing to bind a broad wildcard host (${host}): this exposes Agent Deck on ` +
        `EVERY network interface, and the access token is not a network boundary. ` +
        `Bind a specific address (loopback or a single Tailscale name/IP) instead, ` +
        `or set AGENT_DECK_UNSAFE_BIND=1 to override (you accept the exposure).`,
    )
    this.name = 'UnsafeBindError'
  }
}

/**
 * Resolve + vet the bind host. Refuses a broad wildcard (0.0.0.0 / :: / *) — which
 * would expose the server on every interface — unless AGENT_DECK_UNSAFE_BIND=1.
 * Loopback and a specific (Tailscale/LAN) host always pass. Throws
 * {@link UnsafeBindError} on a refused wildcard so startup fails loudly with why.
 */
export function resolveBindHost(env: NodeJS.ProcessEnv): string {
  const host = env.AGENT_DECK_HOST ?? '127.0.0.1'
  if (isWildcardHost(host) && env.AGENT_DECK_UNSAFE_BIND !== '1') {
    throw new UnsafeBindError(host)
  }
  return host
}

/** Normalize a host entry to a bare lower-cased hostname: strip a scheme, any path,
 * the port, and IPv6 brackets — so `https://Deck.Example.com:8080/` → `deck.example.com`. */
function normalizeHostEntry(value: string): string {
  let h = value.trim().toLowerCase()
  if (!h) return ''
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // strip scheme
  h = h.split('/')[0] ?? '' // strip path
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    h = end === -1 ? h.slice(1) : h.slice(1, end) // bracketed IPv6 → bare
  } else if (h.split(':').length === 2) {
    h = h.split(':')[0] ?? '' // host:port → host (a bare IPv6 has many colons)
  }
  return h
}

/**
 * Resolve extra trusted hostnames for a reverse-proxy / custom-domain deployment.
 * `AGENT_DECK_TRUSTED_HOSTS` is a comma-separated list of hostnames that the Host-
 * and Origin-allowlists accept IN ADDITION to loopback / *.ts.net / the bound host —
 * so a stranger fronting the deck with nginx/Caddy/Cloudflare on `deck.example.com`
 * (which forwards the real Host, not `127.0.0.1`) can authorize that front-door name.
 * Empty by default (no allowlist change); each entry is normalized to a bare hostname.
 */
export function resolveTrustedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.AGENT_DECK_TRUSTED_HOSTS
  if (!raw) return []
  return raw
    .split(',')
    .map(normalizeHostEntry)
    .filter((h) => h.length > 0)
}

export function resolveHermesHome(
  env: NodeJS.ProcessEnv,
  home = homedir(),
  activeProfile?: string,
): string {
  if (env.HERMES_HOME) return env.HERMES_HOME
  const p = activeProfile?.trim()
  if (p && p !== 'default') return join(home, '.hermes', 'profiles', p)
  return join(home, '.hermes')
}

/**
 * Resolve the gateway bearer key. Precedence: the `API_SERVER_KEY` env var, then
 * the top-level `API_SERVER_KEY` in `~/.hermes/config.yaml`. The value is read
 * server-side only and must never be logged, printed, or sent to the browser.
 * Returns null when no key is available (e.g. config file missing/unreadable).
 */
export function resolveHermesApiKey(
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = join(homedir(), '.hermes', 'config.yaml'),
): string | null {
  const fromEnv = env.API_SERVER_KEY?.trim()
  if (fromEnv) return fromEnv

  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return null
  }

  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>).API_SERVER_KEY
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/** Stock Hermes gateway (api_server) default port — DEFAULT_PORT in the gateway's
 * platforms/api_server.py. What a brand-new `hermes gateway` binds with no override. */
const STOCK_GATEWAY_PORT = 8642

/**
 * Resolve the Hermes gateway base URL — the OpenAI-compatible API server the chat
 * runs ride. Precedence, ordered to be MOST intuitive for someone who already runs
 * Hermes (so the deck "just works" with zero configuration):
 *   1. `HERMES_GATEWAY_URL` env — explicit override (a relocated / remote gateway).
 *   2. The user's OWN `~/.hermes/config.yaml` top-level `API_SERVER_PORT` — Hermes
 *      reads the gateway port from `os.getenv("API_SERVER_PORT")`, which it populates
 *      from this key, so reading it lets the deck auto-match whatever port THEIR
 *      gateway actually binds (e.g. a relocated 8643) with no env needed.
 *   3. Stock Hermes default `http://127.0.0.1:8642` — what a fresh gateway binds.
 * (The dashboard has no config.yaml port — it's the `hermes dashboard --port` CLI
 *  default 9119 — so the dashboard default stays a plain stock constant.)
 */
export function resolveHermesGatewayUrl(
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = join(homedir(), '.hermes', 'config.yaml'),
): string {
  const fromEnv = env.HERMES_GATEWAY_URL?.trim()
  if (fromEnv) return fromEnv

  const stock = `http://127.0.0.1:${STOCK_GATEWAY_PORT}`
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return stock
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return stock
  }
  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>).API_SERVER_PORT
    const port =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
    if (Number.isInteger(port) && port > 0 && port < 65536) return `http://127.0.0.1:${port}`
  }
  return stock
}

/** Default parked-shell lifetime: long enough to leave on a phone and come back. */
const DEFAULT_TERMINAL_PARK_GRACE_MS = 24 * 60 * 60 * 1000

/** Parse AGENT_DECK_TERMINAL_PARK_GRACE_MS; non-numeric/non-positive → default. */
function resolveTerminalParkGraceMs(env: NodeJS.ProcessEnv): number {
  const raw = env.AGENT_DECK_TERMINAL_PARK_GRACE_MS?.trim()
  if (!raw) return DEFAULT_TERMINAL_PARK_GRACE_MS
  const ms = Number(raw)
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TERMINAL_PARK_GRACE_MS
}

export interface ServerConfig {
  host: string
  port: number
  /**
   * Remote posture: true when bound to a NON-loopback host OR explicitly forced
   * for a loopback service exposed by a reverse proxy (for example Tailscale
   * Serve). Drives the web REMOTE-MODE banner, terminal gating, and the auth gate.
   * False on a pure loopback bind (this-machine-only, frictionless).
   */
  remote: boolean
  /**
   * Extra trusted hostnames (from AGENT_DECK_TRUSTED_HOSTS) the Host/Origin
   * allowlists accept beyond loopback / *.ts.net / the bound host — for a
   * reverse-proxy / custom-domain remote deployment. Empty by default.
   */
  trustedHosts: string[]
  /**
   * Whether the interactive terminal is enabled on this bind. Loopback = always
   * enabled. Remote = DISABLED by default (a real host shell over the network is
   * dangerous); requires AGENT_DECK_ENABLE_TERMINAL=1 to opt in.
   */
  terminalEnabled: boolean
  /**
   * Whether the terminal may fall back to $HOME when no allowlisted workspace
   * root exists. Off by default (refuse rather than silently open at $HOME);
   * AGENT_DECK_TERMINAL_ALLOW_HOME=1 opts in.
   */
  terminalAllowHome: boolean
  /**
   * How long a disconnected (parked) terminal shell survives awaiting a
   * reattach, in ms. Default 24h: a phone backgrounding the tab drops the
   * socket, and the shell must still be there when the user comes back hours
   * later. AGENT_DECK_TERMINAL_PARK_GRACE_MS overrides (a positive integer).
   */
  terminalParkGraceMs: number
  hermesHome: string
  hermesGatewayUrl: string
  hermesBin: string
  /** Gateway bearer key. Read server-side only; never logged or sent to the browser. */
  hermesApiKey: string | null
  /** Base URL of the loopback hermes dashboard (sessions/agents/skills/config/workspace). */
  hermesDashboardUrl: string
  /** Host header the dashboard expects to authorize the browser-session check. */
  hermesDashboardHost: string
  /**
   * Absolute path to the built web client (apps/web/dist) to serve alongside the
   * API + sockets. When set, the server serves the SPA (with history fallback) so
   * a single process serves the whole app. `null` = dev mode (Vite serves the
   * client separately), so no static serving and the default 404 handler stays.
   */
  webClientRoot: string | null
  /**
   * The curated MCP catalog root (`optional-mcps/`) the MCP Manager reads. Mirrors
   * the CLI's resolution: the `HERMES_OPTIONAL_MCPS` override, else
   * `<hermesHome>/optional-mcps` (a missing dir → an honestly-empty catalog).
   */
  mcpCatalogDir: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const hermesHome = resolveHermesHome(env)
  // Vet the bind host: refuses a broad wildcard unless AGENT_DECK_UNSAFE_BIND=1.
  const host = resolveBindHost(env)
  const remote = !isLoopbackHost(host) || env.AGENT_DECK_REMOTE === '1'
  return {
    host,
    port: Number(env.AGENT_DECK_PORT ?? '7878'),
    // Terminal: always on for loopback; on a remote bind it stays OFF unless the
    // operator explicitly opts in (a real host shell over the network is risky).
    remote,
    trustedHosts: resolveTrustedHosts(env),
    terminalEnabled: !remote || env.AGENT_DECK_ENABLE_TERMINAL === '1',
    terminalAllowHome: env.AGENT_DECK_TERMINAL_ALLOW_HOME === '1',
    terminalParkGraceMs: resolveTerminalParkGraceMs(env),
    hermesHome,
    hermesGatewayUrl: resolveHermesGatewayUrl(env, join(hermesHome, 'config.yaml')),
    hermesBin: env.HERMES_BIN ?? join(homedir(), '.local', 'bin', 'hermes'),
    hermesApiKey: resolveHermesApiKey(env, join(hermesHome, 'config.yaml')),
    // Default to the STOCK Hermes dashboard port (9119; hermes_cli/web_server.py).
    // Operators who relocate it (e.g. behind a Tailscale name) set the env overrides.
    hermesDashboardUrl: env.HERMES_DASHBOARD_URL ?? 'http://127.0.0.1:9119',
    hermesDashboardHost: env.HERMES_DASHBOARD_HOST ?? '127.0.0.1:9119',
    // Default to dev mode (no static serving); the launcher sets this to the
    // built apps/web/dist so one process serves the SPA + API together.
    webClientRoot: env.AGENT_DECK_WEB_CLIENT_ROOT?.trim() || null,
    // MCP catalog: the env override (a source-checkout's optional-mcps/), else
    // the CLI's last-resort under the hermes home.
    mcpCatalogDir: env.HERMES_OPTIONAL_MCPS?.trim() || join(hermesHome, 'optional-mcps'),
  }
}
