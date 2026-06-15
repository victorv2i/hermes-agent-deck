import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import { Server as SocketIOServer } from 'socket.io'
import type { HealthResponse } from '@agent-deck/protocol'
import { loadConfig, type ServerConfig } from './config'
import { RateLimiter, resolveClientKey } from './rateLimit'
import {
  resolveAuth,
  bearerFromHeader,
  tokensMatch,
  isGatedApiPath,
  type AuthConfig,
} from './auth/auth'
import { GatewayClient, type GatewayClientLike } from './hermes/gatewayClient'
import { DashboardClient } from './hermes/dashboardClient'
import { StatusClient } from './hermes/statusClient'
import { registerStatusRoutes } from './hermes/statusRoute'
import { registerChatRunHandlers } from './chat/chatRun'
import { registerSessionRoutes } from './sessions/routes'
import { filesRoutes } from './files/routes'
import { FilesService } from './files/filesService'
import { registerModelsRoutes } from './models/modelsRoute'
import { profilesRoutes } from './profiles/profilesRoute'
import { registerSettingsRoutes } from './settings/settingsRoutes'
import { registerMessagingRoutes } from './messaging/messagingRoutes'
import { registerVoiceRoutes } from './voice/voiceRoutes'
import { usageRoutes } from './usage/usageRoutes'
import { UsageClient } from './usage/usageClient'
import { terminalRoutes } from './terminal/terminalRoutes'
import { workspaceRoutes } from './terminal/workspaceRoutes'
import { WorkspaceStore } from './terminal/workspaceStore'
import { resolveTerminalCwdAvailable } from './terminal/terminalRoots'
import { registerCronRoutes } from './cron/cronRoutes'
import { CronClient } from './cron/cronClient'
import { registerKanbanRoutes } from './kanban/kanbanRoutes'
import { KanbanClient } from './kanban/kanbanClient'
import { registerLogsRoutes } from './logs/logsRoute'
import { LogsClient } from './logs/logsClient'
import { registerSkillsRoutes } from './skills/skillsRoute'
import { SkillsClient } from './skills/skillsClient'
import { registerSkillsHubRoutes } from './skills/skillsHubRoute'
import { registerEnvRoutes } from './settings/envRoute'
import { registerToolsetsRoutes } from './tools/toolsetsRoute'
import { registerOrganizationRoutes } from './organization/organizationRoutes'
import { OrganizationStore } from './organization/organizationStore'
import { registerSetupRoutes } from './setup/setupRoute'
import { registerSystemRoutes } from './system/systemRoutes'
import { listGitRemotes } from './system/gitRemotes'
import { registerMcpRoutes } from './mcp/mcpRoutes'
import { registerConnectionsRoutes } from './connections/connectionsRoutes'
import { registerCliOpRoute } from './system/cliOpRoute'
import { registerSystemStatsRoute } from './system/systemStatsRoute'
import { registerCuratorRoute } from './system/curatorRoute'
import { registerMemoryProviderRoute } from './profiles/memoryProviderRoute'
import { registerProviderValidateRoute } from './settings/providerValidateRoute'

const HEALTH_PROBE_TIMEOUT_MS = 1_500

/**
 * The agent-deck version, read from this package's package.json — the single
 * source of truth for the `/health` and System "Agent Deck" version (was a
 * hardcoded "0.1.0" literal in two places, which would silently lie after a
 * version bump). `createRequire` loads the JSON in ESM without import attributes
 * and resolves the same path under tsx (src) and tsc-emit (dist).
 */
const AGENT_DECK_VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version

/**
 * Default request body size limit (1 MiB). Attached to every Fastify instance
 * via `bodyLimit` in buildApp. Callers that need a LOWER limit (e.g. a tiny
 * ops-only endpoint) can set their own via the route `config` — this just sets
 * the hard global ceiling. Exceeding it returns a 413 (Fastify default) with a
 * clear error body, rather than silently dropping/truncating the payload.
 */
export const DEFAULT_BODY_LIMIT = 1_048_576 // 1 MiB

/**
 * Default Socket.IO max HTTP buffer size (1 MiB). Matches the Fastify bodyLimit
 * so any single-frame payload that gets through the HTTP gate is also bounded
 * at the Socket.IO layer. Socket.IO silently drops frames that exceed this
 * (engine-level close), but with the Fastify gate preceding it, oversized frames
 * never reach the socket — this is a defence-in-depth belt.
 */
export const DEFAULT_SOCKET_BUFFER_SIZE = 1_048_576 // 1 MiB

/**
 * CORS origin allowlist for Fastify and Socket.IO. Accepts:
 * - No origin (same-origin / curl / server-to-server) → always allowed.
 * - Loopback origins (127.0.0.1 / localhost / ::1).
 * - The EXACT bound ts.net hostname (when `boundHost` ends with `.ts.net`).
 * - Any *.ts.net origin when the bound host is NOT a ts.net name (loopback/LAN
 *   bind served through Tailscale Serve — the real node hostname is not known at
 *   bind time, so the Host-allowlist hook is the primary guard).
 *
 * Exported so tests can drive the function directly.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  boundHost: string,
  trustedHosts: readonly string[] = [],
): boolean {
  if (!origin) return true // same-origin / no-CORS request
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  // The URL API returns `[::1]` (with brackets) for IPv6 loopback in an origin.
  if (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return true
  }
  // Tailscale origin: when THIS server is bound to a specific ts.net hostname,
  // only that exact hostname may appear in CORS Origins — not any other *.ts.net.
  // When bound to loopback or a LAN address, we don't know the tailnet name, so
  // accept any *.ts.net (the Host-allowlist hook is the real DNS-rebinding guard).
  if (hostname.endsWith('.ts.net')) {
    const bound = boundHost.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    if (bound.endsWith('.ts.net')) {
      // Strip port from bound if present
      const boundHost2 = bound.split(':')[0]!
      return hostname === boundHost2
    }
    return true // loopback/LAN bind → accept any ts.net origin
  }
  // Operator-configured reverse-proxy / custom-domain front-door hosts.
  if (trustedHosts.includes(hostname)) return true
  return false
}

/**
 * I4 HOST ALLOWLIST (DNS-rebinding defense). The browser sends the `Host` header
 * it connected to; an attacker who lures the user's browser to a hostname that
 * resolves to this server (DNS rebinding) would carry a foreign Host. We accept
 * only loopback, `*.ts.net` (Tailscale), and the host this process is bound to.
 * Port is ignored; an `[::1]:p` style IPv6 host is unbracketed before compare.
 */
export function isAllowedHost(
  hostHeader: string | undefined,
  boundHost: string,
  trustedHosts: readonly string[] = [],
): boolean {
  if (!hostHeader) return false
  // Strip the port. For bracketed IPv6 (`[::1]:7878`) drop the brackets/port; for
  // a plain `host:port` drop the last `:port` (an unbracketed bare IPv6 has many
  // colons and no port, so only strip when there is exactly one colon).
  let host = hostHeader.trim().toLowerCase()
  if (host.startsWith('[')) {
    host = host.slice(1, host.indexOf(']'))
  } else if (host.split(':').length === 2) {
    host = host.split(':')[0]!
  }
  const bound = boundHost.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return (
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.endsWith('.ts.net') ||
    host === bound ||
    // Operator-configured reverse-proxy / custom-domain front-door hosts.
    trustedHosts.includes(host)
  )
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const candidate = record[key]
  return typeof candidate === 'string' ? candidate : null
}

async function probeHermesGateway(endpoint: string): Promise<HealthResponse['hermes']> {
  const url = new URL('/v1/health', endpoint)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return { reachable: false, endpoint, platform: null }
    const body: unknown = await res.json().catch(() => null)
    return {
      reachable: true,
      endpoint,
      platform: getStringProperty(body, 'platform'),
    }
  } catch {
    return { reachable: false, endpoint, platform: null }
  } finally {
    clearTimeout(timeout)
  }
}

export async function buildApp(
  config: ServerConfig = loadConfig(),
  /** Auth posture for this bind. Defaults to {@link resolveAuth} over the bound
   * host: loopback = frictionless, non-loopback = bearer-token gated. */
  auth: AuthConfig = resolveAuth(config.host),
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // I4 BODY LIMIT: reject oversized payloads with 413 (Fastify default) rather
    // than silently dropping or truncating them. 1 MiB is generous for any
    // API call this BFF handles; large file content uses a separate streaming path.
    bodyLimit: DEFAULT_BODY_LIMIT,
  })

  // GLOBAL ERROR HANDLER — the last line of defense against leaking an exception's
  // message to a client. Routes return their OWN honest errors; anything that still
  // ESCAPES a handler (e.g. a malformed config.yaml's YAML parse error, whose message
  // embeds the offending config line — possibly next to a credential) must never reach
  // the browser verbatim. 4xx errors carry safe, schema-derived messages and pass
  // through; 5xx / untyped errors return a generic, content-free body (the real error
  // is logged server-side). Without this, an uncaught throw hits Fastify's default
  // handler, which echoes err.message — the MCP config-parse leak the audit found.
  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err }, 'unhandled route error')
    const e = err as { statusCode?: number; code?: string; message?: string }
    const statusCode = typeof e.statusCode === 'number' ? e.statusCode : 500
    if (statusCode >= 400 && statusCode < 500) {
      reply.code(statusCode).send({ error: e.code ?? 'bad_request', message: e.message })
    } else {
      reply.code(500).send({ error: 'internal_error' })
    }
  })

  await app.register(cors, {
    // No Origin header (curl, same-origin, server-to-server) is allowed; otherwise
    // only loopback / localhost / the EXACT bound ts.net hostname pass, any port.
    // When bound to loopback, any *.ts.net origin is accepted (the operator uses
    // Tailscale Serve; the Host-allowlist hook below is the real DNS-rebinding guard).
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      cb(null, isAllowedOrigin(origin, config.host, config.trustedHosts))
    },
    credentials: false,
  })

  // I4 SECURITY HEADERS: nosniff, frame DENY, and a CSP for the SPA shell.
  // `frame-ancestors 'none'` + X-Frame-Options DENY block clickjacking. The shell
  // CSP allows same-origin assets and the Vite runtime; images allow data:
  // (favicons / inline previews) and same-origin. /files/raw sets its OWN stricter
  // CSP in its handler, which replaces these for that response.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' covers the Vite-built runtime; v1 keeps this simple
        // (no nonce plumbing).
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        // Same-origin XHR/fetch + the Socket.IO websocket upgrade.
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    // X-Frame-Options DENY (helmet defaults to SAMEORIGIN) to match frame-ancestors.
    frameguard: { action: 'deny' },
    crossOriginEmbedderPolicy: false,
  })

  // I4 HOST ALLOWLIST: reject a foreign Host header (DNS-rebinding defense) before
  // any routing/auth. Accepts loopback / *.ts.net / the bound host (see
  // {@link isAllowedHost}). 421 Misdirected Request is the honest status here.
  app.addHook('onRequest', async (request, reply) => {
    if (!isAllowedHost(request.headers.host, config.host, config.trustedHosts)) {
      return reply.code(421).send({ error: 'misdirected_host', message: 'host not allowed' })
    }
  })

  // C1 AUTH GATE (server half): only enforced when `auth.required` is true
  // (non-loopback, or explicitly forced for a proxied loopback service). Every
  // `/api/*` request except the public health probe must carry
  // `Authorization: Bearer <token>`; a missing/mismatched token is 401. The token
  // never appears in the error body.
  if (auth.required) {
    app.addHook('onRequest', async (request, reply) => {
      if (!isGatedApiPath(request.raw.url ?? '')) return
      const provided = bearerFromHeader(request.headers.authorization)
      if (!tokensMatch(auth.token, provided)) {
        return reply.code(401).send({ error: 'unauthorized', message: 'missing or invalid token' })
      }
    })
  }

  // RATE LIMIT: the expensive exec/probe/scan endpoints. These shell out to the
  // hermes binary, open SSE connections, or walk large directory trees — a runaway
  // script or a browser bug could spam them and saturate the process. The limits
  // are generous for interactive use (30 req/min each) and fire a 429 with a clear
  // Retry-After header rather than silently dropping the request.
  const execLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 30 })

  /** Apply the shared exec rate limiter to an exact path (no params). */
  const checkExecLimit = async (
    path: string,
    remoteAddr: string | undefined,
    reply: FastifyReply,
  ): Promise<boolean> => {
    const key = resolveClientKey(remoteAddr)
    const result = execLimiter.check(key)
    if (!result.allowed) {
      reply
        .code(429)
        .header('Retry-After', String(result.retryAfterSecs))
        .send({
          error: 'rate_limited',
          message: `too many requests to ${path}: retry after ${result.retryAfterSecs}s`,
          retryAfterSecs: result.retryAfterSecs,
        })
      return false
    }
    return true
  }

  // Exact path-prefixes (query-string-stripped) subject to the exec rate limiter.
  // `cli-op` shells out to hermes; `mcp/…/test` execs a probe; `files` scans
  // a directory tree via the dashboard; `logs` tails a potentially-large log.
  const RATE_LIMITED_PATHS: ReadonlySet<string> = new Set([
    '/api/agent-deck/cli-op',
    '/api/agent-deck/logs',
    '/api/agent-deck/files', // directory listing / file-tree (with query params)
  ])
  // Prefix-matched: /api/agent-deck/mcp/<name>/test (and any future sub-routes).
  const RATE_LIMITED_PREFIX = '/api/agent-deck/mcp/'

  app.addHook('onRequest', async (request, reply) => {
    const rawUrl = request.raw.url ?? ''
    // Strip query string — we match on the path only.
    const path = rawUrl.split('?')[0] ?? rawUrl
    const matched = RATE_LIMITED_PATHS.has(path) || path.startsWith(RATE_LIMITED_PREFIX)
    if (!matched) return
    await checkExecLimit(path, request.ip, reply)
  })

  app.get('/api/agent-deck/health', async (): Promise<HealthResponse> => {
    const hermes = await probeHermesGateway(config.hermesGatewayUrl)
    return {
      status: hermes.reachable ? 'ok' : 'degraded',
      hermes,
      // Surface the bind posture so the client can honestly show remote mode.
      bind: {
        remote: config.remote,
        terminalEnabled: config.terminalEnabled,
        authRequired: auth.required,
      },
      version: AGENT_DECK_VERSION,
    }
  })

  // Gated token verification probe. On a remote/forced-auth posture, the app-level
  // hook above rejects this route before it runs unless the bearer token matches.
  app.get('/api/agent-deck/auth/check', async () => ({ ok: true }))

  // One shared dashboard client backs every read-only surface that proxies the
  // loopback hermes dashboard (:9123). The session token stays server-side.
  const dashboard = new DashboardClient({
    hermesDashboardUrl: config.hermesDashboardUrl,
    hermesDashboardHost: config.hermesDashboardHost,
  })

  // The cross-source status band reads the dashboard's PUBLIC `/api/status` via a
  // slim (token-less) client — kept separate from the credentialed `dashboard`
  // so the status path never touches the session-token code.
  const statusClient = new StatusClient({
    hermesDashboardUrl: config.hermesDashboardUrl,
    hermesDashboardHost: config.hermesDashboardHost,
  })

  // Surfaces that declare their own fully-qualified `/api/agent-deck/...` paths
  // register with NO prefix.
  await registerSessionRoutes(app, { dashboard })
  await app.register(registerStatusRoutes, { statusClient })
  await app.register(registerModelsRoutes, { dashboard })
  // The Agents-surface skill count for the ACTIVE profile must agree with the
  // Skills browser (dashboard /api/skills — the known, enabled skill set), NOT
  // the raw SKILL.md fs walk which over-counts (disabled + duplicate skills).
  // Best-effort: any dashboard failure leaves the fs count in place.
  const skillsClient = new SkillsClient(dashboard)
  await app.register(profilesRoutes, {
    hermesHome: config.hermesHome,
    hermesBin: config.hermesBin,
    skillCountForActive: async () => {
      try {
        return (await skillsClient.listSkills()).length
      } catch {
        return null
      }
    },
  })
  await app.register(registerSettingsRoutes, { dashboard })
  // Messaging Hub: registry × live `/api/status` connection truth × `/api/env`
  // token shape; the guarded token write (allowlisted to registry bot tokens).
  await app.register(registerMessagingRoutes, { dashboard, statusClient })
  // Voice Console: the tts/stt/voice config blocks (read via /api/config, written
  // confined to those blocks) × shape-only provider keys (/api/env) × the
  // path-guarded list/serve of the REAL cached audio under <HERMES_HOME>/cache/audio.
  await app.register(registerVoiceRoutes, { dashboard, hermesHome: config.hermesHome })
  await app.register(usageRoutes, { usageClient: new UsageClient(dashboard) })
  await app.register(registerCronRoutes, { cronClient: new CronClient(dashboard) })
  await app.register(registerKanbanRoutes, { kanbanClient: new KanbanClient(dashboard) })
  await app.register(registerLogsRoutes, { logsClient: new LogsClient(dashboard) })
  await app.register(registerSkillsRoutes, { dashboard, hermesHome: config.hermesHome })
  // Skills Hub: browse/install/uninstall/update from the hermes hub. All four
  // actions proxy REAL stock routes (web_server.py:5350/5367/5380/5390); the poll
  // uses GET /api/actions/{name}/status (web_server.py:1330). No new fabricated
  // routes — every shape is already in the frozen registry (skills hub routes are
  // registered in knownHermesRoutes.ts; action-status is also listed there).
  await app.register(registerSkillsHubRoutes, { dashboard })
  // Env surface: read/write/delete non-messaging env vars (provider keys, tool
  // keys). Proxies REAL stock GET/PUT/DELETE /api/env (web_server.py:1926/1945/2029).
  // Plaintext values are write-only (NEVER echoed, never logged here); the GET
  // returns only what hermes already redacted server-side (shape-only).
  await app.register(registerEnvRoutes, { dashboard })
  // Connections surface: pairing (device approval), webhooks, and the credential
  // pool. Proxies REAL stock routes (web_server.py:4620-4945). The plugin + its
  // three frontend tabs + tests all shipped, but this registration was missing, so
  // the Pairing/Webhooks/Credentials tabs 404'd for every user — now wired.
  await app.register(registerConnectionsRoutes, { dashboard })
  // Tools surface (READ-ONLY): proxies stock `GET /api/tools/toolsets` — the
  // agent's configurable toolsets (web/browser/terminal/file/vision/…), their
  // enabled/configured state, and the concrete tools each grants. Stock has NO
  // HTTP toggle (that's the `hermes tools` TUI), so the surface is honest read +
  // a copyable CLI command; it never fakes a toggle. No NEW hermes route shape.
  await app.register(registerToolsetsRoutes, { dashboard })
  // Agent Deck's OWN project/tag metadata store (server-side JSON under
  // <HERMES_HOME>/agent-deck/organization.json) — not a dashboard proxy; it
  // syncs across the user's devices that drive this one bind over Tailscale.
  await app.register(registerOrganizationRoutes, {
    store: OrganizationStore.forHermesHome(config.hermesHome),
  })

  // Setup/onboarding (F2): a SEPARATE low-level readiness probe + the guarded
  // provider-key add. `providerConnected` is the one signal that needs the
  // dashboard — read `/api/model/info` and treat a non-empty active model as
  // "connected"; any failure fails closed to not-connected. The provider-key add
  // NEVER logs the key (no `log` wired → silent argv).
  const probeProviderConnected = async (): Promise<boolean> => {
    const info = await dashboard.getJson<{ model?: unknown }>('/api/model/info')
    return typeof info.model === 'string' && info.model.trim().length > 0
  }
  await app.register(registerSetupRoutes, {
    hermesHome: config.hermesHome,
    hermesBin: config.hermesBin,
    probeProviderConnected,
  })

  // System/Maintenance dock (F2): gateway restart + Hermes version/update read +
  // the gated-off agent-deck self-update (no-channel when no git remote). All
  // mutating endpoints sit behind the SAME app-level auth/loopback gate above.
  await app.register(registerSystemRoutes, {
    hermesBin: config.hermesBin,
    agentDeckVersion: AGENT_DECK_VERSION,
    listGitRemotes: () => listGitRemotes(),
  })

  // MCP Server Manager (agent-deck-OWN; fs/exec-backed): LIST configured servers
  // (the config `enabled` flag + the curated catalog) + guided ADD/toggle/remove
  // (the path-guarded mcp_servers slice write) + the REAL non-interactive probe.
  // A masked key is stored via the existing dashboard `PUT /api/env` (already a
  // pinned route) — never written into config.yaml. No NEW hermes route.
  await app.register(registerMcpRoutes, {
    hermesBin: config.hermesBin,
    hermesHome: config.hermesHome,
    catalogDir: config.mcpCatalogDir,
    dashboard,
  })

  // "Do It For Me" BFF: dispatches real `hermes` CLI ops via the ALLOWED_OPS
  // whitelist. NOT a dashboard proxy — calls the hermes binary via execFile.
  // Sits behind the SAME app-level auth/loopback gate as every other /api/* route.
  await app.register(registerCliOpRoute, {
    hermesBin: config.hermesBin,
  })

  // System stats dock addition: live host/process snapshot (GET /api/system/stats,
  // web_server.py:756). Psutil-enriched when present; graceful stdlib-only fallback.
  // SLIM: PID, hostname, python internals stripped — only the user-readable subset.
  await registerSystemStatsRoute(app, { dashboard })

  // Curator dock card: pause/resume/run-now (GET/PUT/POST /api/curator,
  // web_server.py:844/869/877). Degrades to available=false when the module is absent.
  await registerCuratorRoute(app, { dashboard })

  // Memory-provider surface: active provider + catalog + switch + reset
  // (GET /api/memory, PUT /api/memory/provider, POST /api/memory/reset,
  // web_server.py:4983/5018/5042). Switch flags restart_required = true (honest).
  await registerMemoryProviderRoute(app, { dashboard })

  // Provider validate: live-probe a credential before saving
  // (POST /api/providers/validate, web_server.py:1974). Fails open on network error.
  await registerProviderValidateRoute(app, { dashboard })

  // Surfaces that declare relative paths register under the BFF prefix. One
  // FilesService is shared so the terminal cwd gate consults the SAME derived
  // workspace roots the Files surface lists.
  const filesService = new FilesService(dashboard)
  await app.register(filesRoutes, {
    service: filesService,
    prefix: '/api/agent-deck',
  })
  await app.register(terminalRoutes, {
    prefix: '/api/agent-deck/terminal',
    enabled: config.terminalEnabled,
    // cwd_available is FALSE when no workspace root resolves (and $HOME isn't
    // opted in) — so the UI shows a calm panel before the real-shell consent.
    cwdAvailable: () => resolveTerminalCwdAvailable(filesService),
  })
  // Terminal WORKSPACES: server-persisted, cross-device named pane grids
  // (CRUD + the security-hardened cwd picker), sharing the SAME prefix and the
  // SAME derived workspace roots the terminal cwd gate consults, so the picker
  // never widens what dirs are reachable beyond the existing roots policy.
  await app.register(workspaceRoutes, {
    prefix: '/api/agent-deck/terminal',
    store: new WorkspaceStore(),
    roots: async () =>
      (await filesService.listRoots()).map((r) => ({ name: r.label, path: r.path })),
    allowHome: config.terminalAllowHome,
  })

  // PRODUCTION (single-process) serving: when a built web client is configured,
  // serve apps/web/dist as static assets and add an SPA history fallback so deep
  // client routes (e.g. /sessions/x) return index.html. In dev mode
  // (webClientRoot = null) Vite serves the client separately, so this is skipped
  // and the default 404 handler stays intact. Registered LAST so the API routes
  // above win, and so unknown `/api/*` requests still 404 (never the SPA shell).
  if (config.webClientRoot) {
    await registerWebClient(app, config.webClientRoot)
  }

  return app
}

/**
 * Serve the built SPA (apps/web/dist) with a history-mode fallback.
 *
 * `wildcard: true` serves any file under the root live per request, so a rebuild
 * of `dist` while the server runs is served immediately (hashed bundle names
 * change every build). A clean not-found handler does history-mode fallback:
 * unknown client GETs get index.html; API misses / non-GET / missing /assets keep
 * a real 404, so the JSON API is never masked and a missing build artifact is an
 * honest 404 rather than a blank shell.
 *
 * C1: the served `index.html` is public shell only. It never carries the access
 * token; a remote/proxied browser enters the operator token and the gated API +
 * socket paths verify it. We re-read the shell PER REQUEST (so a rebuild
 * self-heals) and serve that live copy at the root and from the SPA history
 * fallback.
 */
async function registerWebClient(app: FastifyInstance, root: string): Promise<void> {
  // `wildcard: true` serves any file under `root` LIVE per request — critical so a
  // rebuild of `dist` while the server runs (hashed bundle names change every
  // build) is served immediately. (`wildcard: false` registered asset routes from
  // the files present at BOOT, so a post-boot rebuild's new hash had no route →
  // SPA fallback → blank screen.) `index: false` + `allowedPath` keep the static
  // plugin from ever serving an uncached `index.html`: `/` and `/index.html`
  // fall through to our live shell handlers below; everything else is a file.
  await app.register(fastifyStatic, {
    root,
    wildcard: true,
    index: false,
    allowedPath: (pathName: string) => pathName !== '/' && pathName !== '/index.html',
  })

  // Re-read the SPA shell from disk on EACH request rather than caching it at
  // boot: a rebuild of `dist` while the server is running (e.g. `pnpm build`
  // against a live instance) would otherwise leave the cached shell pointing at a
  // hashed bundle that no longer exists → a blank screen. This handler only fires
  // for `/` and client navigations (never asset requests), so the read is cheap
  // and the server self-heals after a rebuild.
  const indexPath = join(root, 'index.html')
  const sendShell = (reply: FastifyReply): FastifyReply => {
    try {
      return reply.type('text/html').send(readFileSync(indexPath, 'utf8'))
    } catch {
      return reply
        .code(503)
        .type('text/plain')
        .send('agent-deck: web client not built. Run `pnpm build`.')
    }
  }

  // Serve the live shell at the application root.
  app.get('/', async (_request, reply) => sendShell(reply))

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? ''
    const isClientNavigation =
      request.method === 'GET' &&
      !url.startsWith('/api/') &&
      !url.startsWith('/socket.io') &&
      // A miss under /assets/ is a genuinely-missing build artifact: 404 it
      // honestly instead of returning the HTML shell (which would render blank).
      !url.startsWith('/assets/') &&
      !request.headers.accept?.includes('application/json')
    if (isClientNavigation) {
      return sendShell(reply)
    }
    return reply.code(404).type('application/json').send({ error: 'not_found' })
  })
}

/**
 * Attach the `/chat-run` Socket.IO namespace to a (built) Fastify app's
 * underlying HTTP server. Returns the Socket.IO server so callers can close it.
 * CORS mirrors the Fastify allowlist (loopback / localhost / Tailscale).
 */
export function attachChat(
  app: FastifyInstance,
  config: ServerConfig = loadConfig(),
  /** Inject a gateway client (e.g. the in-process mock for hermetic e2e).
   * Defaults to a real {@link GatewayClient} bound to the configured gateway. */
  gateway: GatewayClientLike = new GatewayClient({
    hermesGatewayUrl: config.hermesGatewayUrl,
    hermesApiKey: config.hermesApiKey,
  }),
  /** Auth posture for the bind; defaults to {@link resolveAuth} over the host. */
  auth: AuthConfig = resolveAuth(config.host),
): SocketIOServer {
  const io = new SocketIOServer(app.server, {
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.host, config.trustedHosts)),
      credentials: false,
    },
    // I4: mirror the HTTP Host allowlist on the socket handshake (DNS-rebinding
    // defense at the engine layer, before either namespace's middleware runs).
    allowRequest: (req, cb) => {
      const ok = isAllowedHost(req.headers.host, config.host, config.trustedHosts)
      cb(ok ? null : 'forbidden host', ok)
    },
    // I4 BUFFER LIMIT: bound individual Socket.IO frames to prevent a malicious
    // or runaway client from sending arbitrarily large payloads. Matches the
    // Fastify bodyLimit for consistency. Engine.io closes the connection when
    // a frame exceeds this (defence-in-depth; the HTTP gate is the primary guard).
    maxHttpBufferSize: DEFAULT_SOCKET_BUFFER_SIZE,
  })
  registerChatRunHandlers(io, { gateway, auth })
  return io
}
