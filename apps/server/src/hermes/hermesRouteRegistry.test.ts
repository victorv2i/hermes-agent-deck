import { describe, it, expect } from 'vitest'
import { KNOWN_HERMES_ROUTES, routeKey, type HttpMethod } from './knownHermesRoutes'

/**
 * CONTRACT-CONFORMANCE TEST - the anti-recurrence net.
 *
 * Agentdeck's BFF must only ever call hermes routes that STOCK hermes actually
 * serves. v1 was built against a retired dashboard overlay and shipped
 * calls to endpoints absent from stock (Models, Files), which silently 404'd.
 * This test makes that class of bug a RED build: every hermes route shape the
 * BFF invokes is asserted to be a member of `KNOWN_HERMES_ROUTES` - the frozen
 * transcription of stock's real route table (`knownHermesRoutes.ts`).
 *
 * `BFF_CALLED_ROUTES` below is a hand-maintained mirror of the BFF's hermes
 * call sites (normalised to `METHOD /path/{param}` shape, query stripped).
 * When a new BFF client calls a new hermes route, add its shape here; if that
 * shape is not in the stock registry, this test fails until the call is
 * re-pointed at a real route (NEVER by adding a fake route to the registry).
 *
 * Models (Lane C) is re-pointed onto three real stock /api/model/* routes.
 * Files (Lane D) is re-pointed off the fabricated /api/workspace/* surface onto
 * GET /api/status (hermes_home) + BFF-local fs reads, so those three entries are
 * gone from `BFF_CALLED_ROUTES`.
 *
 * The shared DashboardClient (Lane A) is re-pointed off the RETIRED
 * `GET /api/auth/session-token` (stock removed it - the token now ships inside
 * index.html as `window.__HERMES_SESSION_TOKEN__`, web_server.py:3881; the
 * endpoint 404s - tests/hermes_cli/test_web_server.py:300-311) onto `GET /`, the
 * SPA catch-all that serves the token-injected page (web_server.py:3927). The
 * BFF reads the token out of that HTML, so `GET /` is the (real) token-source
 * route now listed below, and the fabricated endpoint is gone.
 */

interface BffCall {
  readonly method: HttpMethod
  readonly path: string
  /** BFF call site (file:line) the shape was transcribed from. */
  readonly site: string
}

/**
 * Every distinct hermes route shape the BFF calls today, normalised to the
 * registry's `{param}` convention with query strings removed. Mirror of the
 * `authedFetch` / `getJson` / public-fetch call sites under apps/server/src.
 */
const BFF_CALLED_ROUTES: readonly BffCall[] = [
  // status (public, statusClient.ts)
  { method: 'GET', path: '/api/status', site: 'hermes/statusClient.ts:55' },

  // dashboard session token - read from the SPA root's injected
  // window.__HERMES_SESSION_TOKEN__ (DashboardClient.fetchSessionToken). Real
  // stock route: the SPA catch-all serve_spa (web_server.py:3927).
  { method: 'GET', path: '/', site: 'hermes/dashboardClient.ts:120' },

  // sessions (sessions/routes.ts)
  { method: 'GET', path: '/api/sessions', site: 'sessions/routes.ts' },
  { method: 'GET', path: '/api/sessions/stats', site: 'sessions/routes.ts (stats)' },
  { method: 'GET', path: '/api/sessions/search', site: 'sessions/routes.ts' },
  { method: 'GET', path: '/api/sessions/{id}', site: 'sessions/routes.ts' },
  { method: 'GET', path: '/api/sessions/{id}/messages', site: 'sessions/routes.ts' },
  { method: 'GET', path: '/api/sessions/{id}/export', site: 'sessions/routes.ts (export)' },
  { method: 'DELETE', path: '/api/sessions/{id}', site: 'sessions/routes.ts' },
  { method: 'PATCH', path: '/api/sessions/{id}', site: 'sessions/routes.ts (rename/archive)' },
  { method: 'POST', path: '/api/sessions/prune', site: 'sessions/routes.ts (prune)' },

  // cron (cron/cronClient.ts)
  { method: 'GET', path: '/api/cron/jobs', site: 'cron/cronClient.ts:157' },
  { method: 'GET', path: '/api/cron/jobs/{job_id}', site: 'cron/cronClient.ts:165' },
  { method: 'POST', path: '/api/cron/jobs', site: 'cron/cronClient.ts:173' },
  { method: 'PUT', path: '/api/cron/jobs/{job_id}', site: 'cron/cronClient.ts:197' },
  { method: 'POST', path: '/api/cron/jobs/{job_id}/pause', site: 'cron/cronClient.ts:224' },
  { method: 'POST', path: '/api/cron/jobs/{job_id}/resume', site: 'cron/cronClient.ts:224' },
  { method: 'POST', path: '/api/cron/jobs/{job_id}/trigger', site: 'cron/cronClient.ts:224' },
  { method: 'DELETE', path: '/api/cron/jobs/{job_id}', site: 'cron/cronClient.ts:233' },

  // logs (logs/logsClient.ts)
  { method: 'GET', path: '/api/logs', site: 'logs/logsClient.ts:127' },

  // config / settings (settings/settingsRoutes.ts)
  { method: 'GET', path: '/api/config', site: 'settings/settingsRoutes.ts:39' },
  { method: 'GET', path: '/api/config/schema', site: 'settings/settingsRoutes.ts:40' },
  // guarded single-field write: read-modify-write against stock PUT /api/config
  // (web_server.py:1239), allowlisted scalars only.
  { method: 'PUT', path: '/api/config', site: 'settings/settingsRoutes.ts (config/field)' },

  // skills (skills/skillsClient.ts)
  { method: 'GET', path: '/api/skills', site: 'skills/skillsClient.ts:61' },
  { method: 'PUT', path: '/api/skills/toggle', site: 'skills/skillsClient.ts:74' },

  // analytics / usage (usage/usageClient.ts) - the rollup, PLUS the per-model
  // billing_provider join (web_server.py:3239) that lets the BFF derive an honest
  // billing mode instead of mislabeling a $0 subscription window as "free".
  { method: 'GET', path: '/api/analytics/usage', site: 'usage/usageClient.ts' },
  { method: 'GET', path: '/api/analytics/models', site: 'usage/usageClient.ts' },

  // messaging hub (messaging/messagingRoutes.ts) - registry × live status × env.
  // GET reads the stock env shape (web_server.py:1249); the token write proxies
  // the stock env write (web_server.py:1268), allowlisted to registry bot tokens
  // only. (GET /api/status is already listed above via statusClient.)
  { method: 'GET', path: '/api/env', site: 'messaging/messagingRoutes.ts' },
  { method: 'PUT', path: '/api/env', site: 'messaging/messagingRoutes.ts' },

  // voice console (voice/voiceRoutes.ts) - composes the tts/stt/voice config
  // blocks (GET /api/config, web_server.py:910), writes them confined to those
  // blocks (read-modify-write against PUT /api/config, web_server.py:1239), and
  // reads/writes provider key SHAPE via /api/env (GET web_server.py:1249 / PUT
  // web_server.py:1268, allowlisted to known voice key vars). The audio
  // list/serve routes are agent-deck-OWN BFF-LOCAL fs reads (no hermes call), so
  // they contribute no NEW route shape there. The "Speak this" test and the
  // ElevenLabs voice picker proxy the two new REAL stock audio routes.
  { method: 'GET', path: '/api/config', site: 'voice/voiceRoutes.ts' },
  { method: 'PUT', path: '/api/config', site: 'voice/voiceRoutes.ts' },
  { method: 'GET', path: '/api/env', site: 'voice/voiceRoutes.ts' },
  { method: 'PUT', path: '/api/env', site: 'voice/voiceRoutes.ts' },
  // "Speak this" test - proxies POST /api/audio/speak (web_server.py:1265).
  { method: 'POST', path: '/api/audio/speak', site: 'voice/voiceRoutes.ts (speak)' },
  // ElevenLabs voice picker - proxies GET /api/audio/elevenlabs/voices (web_server.py:1215).
  { method: 'GET', path: '/api/audio/elevenlabs/voices', site: 'voice/voiceRoutes.ts (el-voices)' },
  // Composer DICTATION - proxies POST /api/audio/transcribe (web_server.py:1130):
  // the browser records the user speaking, the BFF forwards the clip, hermes returns
  // the transcript. The durable any-browser voice-input path.
  { method: 'POST', path: '/api/audio/transcribe', site: 'voice/voiceRoutes.ts (transcribe)' },

  // MCP Server Manager (mcp/mcpRoutes.ts) - an agent-deck-OWN surface: the LIST +
  // add/toggle/remove writes touch the `~/.hermes/config.yaml` `mcp_servers` slice
  // DIRECTLY (path-guarded fs), the catalog is a path-guarded manifest read, and
  // the `test` probe execs `hermes mcp test <name>` (the CLI, not an HTTP route).
  // The ONLY hermes HTTP route it calls is the masked-key store via stock
  // `PUT /api/env` (web_server.py:1268) - already listed above for messaging, so
  // it adds NO new route shape. (Listed here for provenance, deduped by routeKey.)
  { method: 'PUT', path: '/api/env', site: 'mcp/mcpRoutes.ts (masked key store)' },

  // models - re-pointed (Lane C) onto real stock /api/model/* endpoints, fetched
  // concurrently by the BFF (web_server.py:937 / :1037 / :1055), plus the oauth
  // status read (web_server.py:1573) that drives the `usable` flag.
  { method: 'GET', path: '/api/model/info', site: 'models/modelsRoute.ts' },
  { method: 'GET', path: '/api/model/options', site: 'models/modelsRoute.ts' },
  { method: 'GET', path: '/api/model/auxiliary', site: 'models/modelsRoute.ts' },
  { method: 'GET', path: '/api/providers/oauth', site: 'models/modelsRoute.ts' },
  {
    method: 'POST',
    path: '/api/providers/oauth/{provider_id}/start',
    site: 'models/modelsRoute.ts',
  },
  {
    method: 'POST',
    path: '/api/providers/oauth/{provider_id}/submit',
    site: 'models/modelsRoute.ts',
  },
  {
    method: 'GET',
    path: '/api/providers/oauth/{provider_id}/poll/{session_id}',
    site: 'models/modelsRoute.ts',
  },
  {
    method: 'DELETE',
    path: '/api/providers/oauth/sessions/{session_id}',
    site: 'models/modelsRoute.ts',
  },
  {
    method: 'DELETE',
    path: '/api/providers/oauth/{provider_id}',
    site: 'models/modelsRoute.ts',
  },
  // models - the cross-provider switch proxies the stock POST /api/model/set
  // (web_server.py:1099).
  { method: 'POST', path: '/api/model/set', site: 'models/modelsRoute.ts' },

  // files - re-pointed (Lane D) off the fabricated /api/workspace/* surface.
  // listRoots() now derives workspace roots from GET /api/status (hermes_home,
  // already listed above via statusClient); directory/file reads are BFF-local
  // fs reads, not hermes calls - so Files contributes no NEW route shape here.

  // skills hub (skills/skillsHubRoute.ts) - browse/install/uninstall/update.
  // All four routes are REAL stock hermes endpoints (web_server.py:5390/5350/5367/5380).
  // The action-status poll reuses GET /api/actions/{name}/status (web_server.py:794),
  // already listed above; deduped by routeKey.
  { method: 'GET', path: '/api/skills/hub/search', site: 'skills/skillsHubRoute.ts' },
  { method: 'POST', path: '/api/skills/hub/install', site: 'skills/skillsHubRoute.ts' },
  { method: 'POST', path: '/api/skills/hub/uninstall', site: 'skills/skillsHubRoute.ts' },
  { method: 'POST', path: '/api/skills/hub/update', site: 'skills/skillsHubRoute.ts' },
  { method: 'GET', path: '/api/actions/{name}/status', site: 'skills/skillsHubRoute.ts (poll)' },

  // env surface (settings/envRoute.ts) - provider/tool/voice key CRUD (shape-only).
  // GET/PUT/DELETE /api/env are all real stock routes (web_server.py:1926/1945/2029).
  // Already listed above for messaging + voice + mcp; deduped by routeKey.
  { method: 'GET', path: '/api/env', site: 'settings/envRoute.ts' },
  { method: 'PUT', path: '/api/env', site: 'settings/envRoute.ts' },
  { method: 'DELETE', path: '/api/env', site: 'settings/envRoute.ts' },

  // system stats (system/systemStatsRoute.ts) - proxies real stock GET /api/system/stats
  // (web_server.py:756); psutil-enriched when present, graceful fallback when absent.
  { method: 'GET', path: '/api/system/stats', site: 'system/systemStatsRoute.ts' },

  // curator (system/curatorRoute.ts) - proxies real stock curator routes
  // (web_server.py:844/869/877). Pause/resume/run-now controls.
  { method: 'GET', path: '/api/curator', site: 'system/curatorRoute.ts (status)' },
  { method: 'PUT', path: '/api/curator/paused', site: 'system/curatorRoute.ts (pause)' },
  { method: 'POST', path: '/api/curator/run', site: 'system/curatorRoute.ts (run-now)' },

  // memory provider (profiles/memoryProviderRoute.ts) - proxies real stock routes
  // (web_server.py:4983/5018/5042). Read active provider + catalog, switch, reset.
  { method: 'GET', path: '/api/memory', site: 'profiles/memoryProviderRoute.ts (status)' },
  { method: 'PUT', path: '/api/memory/provider', site: 'profiles/memoryProviderRoute.ts (set)' },
  {
    method: 'POST',
    path: '/api/memory/reset',
    site: 'profiles/memoryProviderRoute.ts (reset)',
  },

  // provider validate (settings/providerValidateRoute.ts) - proxies real stock
  // POST /api/providers/validate (web_server.py:1974). Live-probes a key.
  {
    method: 'POST',
    path: '/api/providers/validate',
    site: 'settings/providerValidateRoute.ts',
  },

  // Agent Studio (profiles/studioRoute.ts) - per-profile authoring through hermes's
  // OWN per-profile dashboard API, scoped by ?profile= / body.profile. Config
  // (GET/PUT /api/config), model options (GET /api/model/options), skills (GET
  // /api/skills + PUT /api/skills/toggle), and env (GET/PUT /api/env) are all real
  // stock routes already listed above (deduped by routeKey). The Studio adds three
  // route SHAPES not previously called by the BFF: the per-profile model set and
  // the soul GET/PUT (the former fs-backed soul route never hit the dashboard).
  // All three are members of the frozen registry (web_server.py:9080/9035/9046).
  {
    method: 'PUT',
    path: '/api/profiles/{name}/model',
    site: 'profiles/studioRoute.ts (model set)',
  },
  { method: 'GET', path: '/api/profiles/{name}/soul', site: 'profiles/studioRoute.ts (soul read)' },
  {
    method: 'PUT',
    path: '/api/profiles/{name}/soul',
    site: 'profiles/studioRoute.ts (soul write)',
  },

  // kanban plugin (kanban/kanbanClient.ts) - all real, mounted /api/plugins/kanban
  { method: 'GET', path: '/api/plugins/kanban/board', site: 'kanban/kanbanClient.ts:314' },
  { method: 'GET', path: '/api/plugins/kanban/boards', site: 'kanban/kanbanClient.ts:350' },
  {
    method: 'GET',
    path: '/api/plugins/kanban/tasks/{task_id}',
    site: 'kanban/kanbanClient.ts:355',
  },
  {
    method: 'GET',
    path: '/api/plugins/kanban/workers/active',
    site: 'kanban/kanbanClient.ts:360',
  },
  { method: 'GET', path: '/api/plugins/kanban/stats', site: 'kanban/kanbanClient.ts:365' },
  // kanban MUTATIONS (the writable cut). Each maps 1:1 onto a real stock plugin
  // route: create → POST /tasks (plugin_api.py:586); move → POST /tasks/bulk with a
  // single id (plugin_api.py:1148); comment → POST /tasks/:id/comments
  // (plugin_api.py:1078). All three are members of the frozen registry already.
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks',
    site: 'kanban/kanbanClient.ts (createTask)',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/bulk',
    site: 'kanban/kanbanClient.ts (moveTask)',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/comments',
    site: 'kanban/kanbanClient.ts (addComment)',
  },

  // connections (connections/connectionsRoutes.ts) - pairing / webhooks / credential
  // pool. All real stock routes (web_server.py:4620-4945). This whole client was
  // previously absent from BOTH this mirror AND app.ts's registration, so it shipped
  // unwired and slipped the net; now registered + mirrored here.
  { method: 'GET', path: '/api/pairing', site: 'connections/connectionsRoutes.ts:71' },
  { method: 'POST', path: '/api/pairing/approve', site: 'connections/connectionsRoutes.ts:84' },
  { method: 'POST', path: '/api/pairing/revoke', site: 'connections/connectionsRoutes.ts:109' },
  {
    method: 'POST',
    path: '/api/pairing/clear-pending',
    site: 'connections/connectionsRoutes.ts:130',
  },
  { method: 'GET', path: '/api/webhooks', site: 'connections/connectionsRoutes.ts:149' },
  { method: 'POST', path: '/api/webhooks', site: 'connections/connectionsRoutes.ts:162' },
  { method: 'DELETE', path: '/api/webhooks/{name}', site: 'connections/connectionsRoutes.ts:190' },
  {
    method: 'PUT',
    path: '/api/webhooks/{name}/enabled',
    site: 'connections/connectionsRoutes.ts:218',
  },
  { method: 'GET', path: '/api/credentials/pool', site: 'connections/connectionsRoutes.ts:245' },
  { method: 'POST', path: '/api/credentials/pool', site: 'connections/connectionsRoutes.ts:258' },
  {
    method: 'DELETE',
    path: '/api/credentials/pool/{provider}/{index}',
    site: 'connections/connectionsRoutes.ts:290',
  },
]

describe('hermes route registry conformance', () => {
  it('the frozen registry is non-empty and keyed METHOD /path', () => {
    expect(KNOWN_HERMES_ROUTES.size).toBeGreaterThan(0)
    expect(KNOWN_HERMES_ROUTES.has(routeKey('GET', '/api/status'))).toBe(true)
  })

  it('includes directly verified stock PATCH route shapes', () => {
    expect(KNOWN_HERMES_ROUTES.has(routeKey('PATCH', '/api/profiles/{name}'))).toBe(true)
    expect(KNOWN_HERMES_ROUTES.has(routeKey('PATCH', '/api/plugins/kanban/tasks/{task_id}'))).toBe(
      true,
    )
    expect(KNOWN_HERMES_ROUTES.has(routeKey('PATCH', '/api/plugins/kanban/boards/{slug}'))).toBe(
      true,
    )
    expect(
      KNOWN_HERMES_ROUTES.has(routeKey('PATCH', '/api/plugins/kanban/profiles/{profile_name}')),
    ).toBe(true)
  })

  it('tracks dashboard auth logout at its root-mounted stock path', () => {
    expect(KNOWN_HERMES_ROUTES.has(routeKey('POST', '/auth/logout'))).toBe(true)
    expect(KNOWN_HERMES_ROUTES.has(routeKey('POST', '/api/auth/logout'))).toBe(false)
  })

  it.each(BFF_CALLED_ROUTES)(
    'BFF call $method $path ($site) is a real stock route',
    ({ method, path }) => {
      expect(KNOWN_HERMES_ROUTES.has(routeKey(method, path))).toBe(true)
    },
  )

  it('every BFF-called route shape is a member of the stock registry', () => {
    const fabricated = BFF_CALLED_ROUTES.filter(
      ({ method, path }) => !KNOWN_HERMES_ROUTES.has(routeKey(method, path)),
    ).map(({ method, path, site }) => `${routeKey(method, path)}  (${site})`)

    // Empty array == every BFF call points at a real stock route. A non-empty
    // diff is the net catching a fabricated/retired endpoint before it ships.
    expect(fabricated).toEqual([])
  })
})
