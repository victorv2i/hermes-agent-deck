import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp, attachChat, isAllowedOrigin } from './app'
import { loadConfig } from './config'
import { resolveAuth, loadOrCreatePersistedToken } from './auth/auth'
import { DashboardClient } from './hermes/dashboardClient'
import { FilesService } from './files/filesService'
import { registerTerminalHandlers } from './terminal/terminalNamespace'
import { resolveTerminalRoots } from './terminal/terminalRoots'
import { registerKanbanHandlers } from './kanban/kanbanNamespace'
import { KanbanClient } from './kanban/kanbanClient'

/**
 * Resolve the built web client to serve in single-process mode. An explicit
 * AGENT_DECK_WEB_CLIENT_ROOT (set by the launcher) wins. Otherwise default to the
 * monorepo's apps/web/dist relative to this module — works from both the compiled
 * dist (apps/server/dist/index.js) and tsx dev (apps/server/src/index.ts) — but
 * only when it actually exists, so a dev run without a built client stays in dev
 * mode (Vite serves the client) instead of 404ing everything.
 */
function resolveWebClientRoot(explicit: string | null): string | null {
  if (explicit) return explicit
  const here = dirname(fileURLToPath(import.meta.url)) // .../apps/server/{dist|src}
  const candidate = join(here, '..', '..', 'web', 'dist')
  return existsSync(join(candidate, 'index.html')) ? candidate : null
}

const baseConfig = loadConfig()
const config = { ...baseConfig, webClientRoot: resolveWebClientRoot(baseConfig.webClientRoot) }

// C1: resolve the auth posture ONCE from the bound host/env and share it across
// the HTTP gate and socket namespaces — a single source of truth. Loopback =
// frictionless unless forced; remote/proxied = token-gated.
// On a gated bind with no AGENT_DECK_TOKEN set, persist the auto-generated token so
// it's STABLE across restarts (a remote operator who unlocked once stays unlocked).
const auth = resolveAuth(config.host, process.env, () => loadOrCreatePersistedToken())

const app = await buildApp(config, auth)
// One Socket.IO server backs both namespaces: attachChat constructs it and
// registers `/chat-run`; we reuse it for the terminal `/agent-deck-terminal`
// namespace so the two never collide on a second engine path.
const io = attachChat(app, config, undefined, auth)

// Open the terminal in a workspace directory, not $HOME: resolve the dashboard's
// workspace roots at startup and hand them to the pty cwd. Best-effort — if the
// dashboard is unreachable this yields [] and, with allowHome off (the default),
// the pty refuses to spawn (NoWorkspaceRootError) rather than dropping into $HOME;
// $HOME is used only when AGENT_DECK_TERMINAL_ALLOW_HOME=1.
const dashboard = new DashboardClient({
  hermesDashboardUrl: config.hermesDashboardUrl,
  hermesDashboardHost: config.hermesDashboardHost,
})
// Live kanban board updates over the same shared io (`/kanban` namespace). The
// poller reads the native kanban plugin through the shared dashboard client; on a
// hermes without the plugin it relays `{ available: false }` and stays calm.
registerKanbanHandlers(io, {
  kanbanClient: new KanbanClient(dashboard),
  auth,
  // Use the SHARED host/origin allowlist (incl. the bound host + any configured
  // AGENT_DECK_TRUSTED_HOSTS) so the kanban WS isn't stricter than chat.
  isAllowedOrigin: (origin) => isAllowedOrigin(origin, config.host, config.trustedHosts),
})

const terminalRoots = await resolveTerminalRoots(new FilesService(dashboard))
registerTerminalHandlers(io, {
  roots: terminalRoots,
  auth,
  // The web UI's multi-terminal view caps at 12 terminals; match it on the server
  // so the cap stays honest (the 12th client terminal must still get a pty).
  maxSessions: 12,
  // Gate the terminal off on a remote bind unless explicitly enabled, and never
  // fall back to $HOME unless explicitly allowed (both resolved in loadConfig).
  enabled: config.terminalEnabled,
  allowHome: config.terminalAllowHome,
  // Keep a disconnected shell parked long enough for a phone user to come back
  // hours later (default 24h; AGENT_DECK_TERMINAL_PARK_GRACE_MS overrides).
  parkGraceMs: config.terminalParkGraceMs,
  // Use the SHARED host/origin allowlist (incl. the bound host + any configured
  // AGENT_DECK_TRUSTED_HOSTS) instead of the local loopback-only default — so the
  // terminal WS isn't rejected on a legitimate bound-host / reverse-proxy origin
  // that chat already accepts.
  isAllowedOrigin: (origin) => isAllowedOrigin(origin, config.host, config.trustedHosts),
})

await app.listen({ host: config.host, port: config.port })
const url = `http://${config.host}:${config.port}`
if (config.webClientRoot) {
  console.log(`agent-deck ready. Open ${url}`)
} else {
  console.log(`agent-deck API on ${url} (dev mode: run the Vite client separately)`)
}

// C1: on a NON-loopback bind the app is reachable by other machines, so it is
// token-gated. Print the bound URL + token ONCE so the operator can authenticate
// (when auto-generated this is the only place it appears). A loopback bind needs
// nothing. The token is intentionally surfaced here — this is the operator
// console, not a request/response path.
if (auth.required) {
  const posture = config.remote ? 'remote/proxied' : 'forced-auth local'
  console.log(`agent-deck is running in ${posture} mode on ${config.host}. Auth is REQUIRED.`)
  console.log(`  access token: ${auth.token}`)
  if (auth.autoGenerated) {
    console.log('  (auto-generated + saved to ~/.agent-deck/auth-token, so it stays the')
    console.log('   same across restarts; set AGENT_DECK_TOKEN to pin your own instead)')
  }
  console.log('  Enter this token in the browser unlock screen; it is never injected into HTML.')
}

// Graceful shutdown. `systemctl restart`/`stop` sends SIGTERM, which by default
// kills the process WITHOUT firing Socket.IO's engine 'close', the only pty
// teardown path (terminalNamespace), so parked shells and their node-pty children
// would leak on every restart (worst in the non-tmux fallback, whose park grace
// defaults to 24h). Closing io runs that cleanup; then close the HTTP server.
// Bounded by a short timer so a wedged socket can't hang the unit's stop, and
// idempotent so a second signal is a no-op.
let shuttingDown = false
function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`agent-deck received ${signal}, shutting down`)
  const force = setTimeout(() => process.exit(0), 3000)
  force.unref()
  io.close(() => {
    void app.close().finally(() => process.exit(0))
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
