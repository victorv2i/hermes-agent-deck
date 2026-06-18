/**
 * KNOWN_HERMES_ROUTES — the frozen, hand-transcribed allowlist of every HTTP
 * route that STOCK hermes v0.15.2 actually serves.
 *
 * This is the anti-recurrence net. Agentdeck v1 was built against a RETIRED
 * dashboard overlay and ended up calling endpoints that do not exist in
 * stock (Models `/api/chat/model-state`, Files `/api/workspace/{roots,tree,file}`),
 * so those surfaces silently 404'd. To make that class of bug impossible to ship
 * again, `hermesRouteRegistry.test.ts` asserts that EVERY hermes path the BFF
 * calls is a member of this set — and this set mirrors stock reality, never a
 * wishlist. The ONLY correct way to make a fabricated-route failure go green is
 * to re-point the BFF at a real route below, NOT to add the fake route here.
 *
 * SOURCE OF TRUTH (cited per entry; paths are relative to the hermes-agent repo):
 *  - `hermes_cli/web_server.py` — `@app.(get|post|put|delete|patch)`
 *    decorators. Cited as `web_server.py:<line>`.
 *  - `hermes_cli/dashboard_auth/routes.py` — the dashboard
 *    auth router, mounted at root (`web_server.py:4835`). Cited as
 *    `dashboard_auth/routes.py:<line>`.
 *  - `plugins/kanban/dashboard/plugin_api.py` — the kanban
 *    plugin's `@router.*` routes, auto-mounted with prefix `/api/plugins/kanban`
 *    (`web_server.py:4821`, `app.include_router(router, prefix=f"/api/plugins/{plugin['name']}")`).
 *    Cited as `plugin_api.py:<line>`.
 *
 * NORMALISATION: path parameters are written as `{param}` (e.g. `{id}`, `{name}`,
 * `{verb}`) regardless of the param's name upstream, so the registry matches on
 * route SHAPE. `routeKey(method, path)` (below) normalises a concrete BFF call
 * (`/api/sessions/abc123` → `/api/sessions/{id}`) to this shape for membership
 * checks. Query strings are stripped before normalisation.
 *
 * This file is DATA, not logic — keep it a literal transcription. When stock
 * gains or drops a route, update this set (with the new line cite) deliberately.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/** One stock route: method + normalised path shape, with its source-line cite. */
export interface KnownHermesRoute {
  readonly method: HttpMethod
  readonly path: string
  /** `web_server.py:<line>` or `plugin_api.py:<line>` the route is declared at. */
  readonly cite: string
}

/**
 * Build the canonical `METHOD path` key for a route shape. Used both to key the
 * frozen set and to normalise an outgoing BFF call before the membership check.
 */
export function routeKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`
}

const ROUTES: readonly KnownHermesRoute[] = [
  // --- SPA root: the catch-all GET that serves index.html with the ephemeral
  // session token injected as window.__HERMES_SESSION_TOKEN__. This is the stock
  // mechanism the BFF uses to obtain the dashboard session token (there is NO
  // /api/auth/session-token endpoint in stock — it 404s). The catch-all is
  // `@application.get("/{full_path:path}")` (serve_spa → _serve_index). ---
  { method: 'GET', path: '/', cite: 'web_server.py:3927' },

  // --- core app routes (hermes_cli/web_server.py @app.*) ---
  { method: 'GET', path: '/api/status', cite: 'web_server.py:570' },
  { method: 'POST', path: '/api/gateway/restart', cite: 'web_server.py:764' },
  { method: 'POST', path: '/api/hermes/update', cite: 'web_server.py:779' },
  { method: 'GET', path: '/api/actions/{name}/status', cite: 'web_server.py:794' },
  { method: 'GET', path: '/api/sessions', cite: 'web_server.py:1360' },
  { method: 'GET', path: '/api/sessions/search', cite: 'web_server.py:1414' },
  { method: 'GET', path: '/api/config', cite: 'web_server.py:910' },
  { method: 'GET', path: '/api/config/defaults', cite: 'web_server.py:917' },
  { method: 'GET', path: '/api/config/schema', cite: 'web_server.py:922' },
  { method: 'GET', path: '/api/model/info', cite: 'web_server.py:937' },
  { method: 'GET', path: '/api/model/options', cite: 'web_server.py:1037' },
  { method: 'GET', path: '/api/model/auxiliary', cite: 'web_server.py:1055' },
  { method: 'POST', path: '/api/model/set', cite: 'web_server.py:1099' },
  { method: 'PUT', path: '/api/config', cite: 'web_server.py:1239' },
  { method: 'GET', path: '/api/env', cite: 'web_server.py:1249' },
  { method: 'PUT', path: '/api/env', cite: 'web_server.py:1268' },
  { method: 'DELETE', path: '/api/env', cite: 'web_server.py:1284' },
  { method: 'POST', path: '/api/env/reveal', cite: 'web_server.py:1298' },
  { method: 'GET', path: '/api/providers/oauth', cite: 'web_server.py:1573' },
  { method: 'DELETE', path: '/api/providers/oauth/{provider_id}', cite: 'web_server.py:1605' },
  { method: 'POST', path: '/api/providers/oauth/{provider_id}/start', cite: 'web_server.py:2346' },
  { method: 'POST', path: '/api/providers/oauth/{provider_id}/submit', cite: 'web_server.py:2384' },
  {
    method: 'GET',
    path: '/api/providers/oauth/{provider_id}/poll/{session_id}',
    cite: 'web_server.py:2395',
  },
  {
    method: 'DELETE',
    path: '/api/providers/oauth/sessions/{session_id}',
    cite: 'web_server.py:2412',
  },
  { method: 'GET', path: '/api/sessions/stats', cite: 'web_server.py:3916' },
  { method: 'GET', path: '/api/sessions/{id}', cite: 'web_server.py:3948' },
  { method: 'GET', path: '/api/sessions/{id}/latest-descendant', cite: 'web_server.py:3963' },
  { method: 'GET', path: '/api/sessions/{id}/messages', cite: 'web_server.py:3975' },
  { method: 'DELETE', path: '/api/sessions/{id}', cite: 'web_server.py:3989' },
  { method: 'PATCH', path: '/api/sessions/{id}', cite: 'web_server.py:4006' },
  { method: 'GET', path: '/api/sessions/{id}/export', cite: 'web_server.py:4040' },
  { method: 'POST', path: '/api/sessions/prune', cite: 'web_server.py:4063' },
  { method: 'GET', path: '/api/logs', cite: 'web_server.py:2563' },
  { method: 'GET', path: '/api/cron/jobs', cite: 'web_server.py:2712' },
  { method: 'GET', path: '/api/cron/jobs/{job_id}', cite: 'web_server.py:2730' },
  { method: 'POST', path: '/api/cron/jobs', cite: 'web_server.py:2741' },
  { method: 'PUT', path: '/api/cron/jobs/{job_id}', cite: 'web_server.py:2757' },
  { method: 'POST', path: '/api/cron/jobs/{job_id}/pause', cite: 'web_server.py:2771' },
  { method: 'POST', path: '/api/cron/jobs/{job_id}/resume', cite: 'web_server.py:2782' },
  { method: 'POST', path: '/api/cron/jobs/{job_id}/trigger', cite: 'web_server.py:2793' },
  { method: 'DELETE', path: '/api/cron/jobs/{job_id}', cite: 'web_server.py:2804' },
  { method: 'GET', path: '/api/profiles', cite: 'web_server.py:2914' },
  { method: 'POST', path: '/api/profiles', cite: 'web_server.py:2924' },
  { method: 'GET', path: '/api/profiles/{name}/setup-command', cite: 'web_server.py:2955' },
  { method: 'POST', path: '/api/profiles/{name}/open-terminal', cite: 'web_server.py:2960' },
  { method: 'PATCH', path: '/api/profiles/{name}', cite: 'web_server.py:3014' },
  { method: 'DELETE', path: '/api/profiles/{name}', cite: 'web_server.py:3029' },
  { method: 'GET', path: '/api/profiles/{name}/soul', cite: 'web_server.py:3047' },
  { method: 'PUT', path: '/api/profiles/{name}/soul', cite: 'web_server.py:3058' },
  // Set the main model (model.default + model.provider) for a SPECIFIC profile's
  // config.yaml without touching the dashboard's own active profile (the Studio's
  // per-agent model picker). Mirrors POST /api/model/set but scoped to {name} via
  // the HERMES_HOME override. Verified present in the installed hermes (config
  // schema v29) at web_server.py:9080.
  { method: 'PUT', path: '/api/profiles/{name}/model', cite: 'web_server.py:9080' },
  { method: 'GET', path: '/api/skills', cite: 'web_server.py:3079' },
  { method: 'PUT', path: '/api/skills/toggle', cite: 'web_server.py:3091' },
  // Skills Hub — browse (search) + install/uninstall/update (background actions).
  // Install + uninstall require a gateway restart to take effect (honest copy).
  { method: 'GET', path: '/api/skills/hub/search', cite: 'web_server.py:5390' },
  { method: 'POST', path: '/api/skills/hub/install', cite: 'web_server.py:5350' },
  { method: 'POST', path: '/api/skills/hub/uninstall', cite: 'web_server.py:5367' },
  { method: 'POST', path: '/api/skills/hub/update', cite: 'web_server.py:5380' },
  // Action status poll — used by the hub to poll install/uninstall/update progress.
  // Already listed above (web_server.py:794) under the action block; repeated here
  // for provenance. The registry deduplicates by routeKey, so no double-entry risk.
  // --- system stats (read-only host/process snapshot, graceful if psutil missing) ---
  { method: 'GET', path: '/api/system/stats', cite: 'web_server.py:756' },

  // --- curator (skill-maintenance background process) ---
  { method: 'GET', path: '/api/curator', cite: 'web_server.py:844' },
  { method: 'PUT', path: '/api/curator/paused', cite: 'web_server.py:869' },
  { method: 'POST', path: '/api/curator/run', cite: 'web_server.py:877' },

  // --- memory provider (read active + catalog, switch provider, reset built-in files) ---
  { method: 'GET', path: '/api/memory', cite: 'web_server.py:4983' },
  { method: 'PUT', path: '/api/memory/provider', cite: 'web_server.py:5018' },
  { method: 'POST', path: '/api/memory/reset', cite: 'web_server.py:5042' },

  // --- provider validate (live-probe a credential key before saving) ---
  { method: 'POST', path: '/api/providers/validate', cite: 'web_server.py:1974' },

  { method: 'GET', path: '/api/tools/toolsets', cite: 'web_server.py:5716' },
  // Toggle a toolset on/off for the cli platform (persists to platform_toolsets.cli).
  // Body: { enabled: bool }. Returns { ok, name, enabled }. (web_server.py:5752)
  { method: 'PUT', path: '/api/tools/toolsets/{name}', cite: 'web_server.py:5752' },
  // Return provider matrix + key status for a toolset's config panel.
  { method: 'GET', path: '/api/tools/toolsets/{name}/config', cite: 'web_server.py:5782' },
  // Persist a provider selection for a toolset (no key prompting).
  { method: 'PUT', path: '/api/tools/toolsets/{name}/provider', cite: 'web_server.py:5837' },

  // --- audio / voice synthesis + transcription (hermes_cli/web_server.py) ---
  // The real stock routes the Voice Console BFF proxies for the "Speak this"
  // test + ElevenLabs voice picker. Do NOT add fabricated paths.
  //   POST /api/audio/speak              web_server.py:1265 (TTS -> base64 data URL)
  //   GET  /api/audio/elevenlabs/voices  web_server.py:1215 (key-gated voice list)
  //   POST /api/audio/transcribe         web_server.py:1130 (STT -- not used via browser mic)
  { method: 'POST', path: '/api/audio/speak', cite: 'web_server.py:1265' },
  { method: 'GET', path: '/api/audio/elevenlabs/voices', cite: 'web_server.py:1215' },
  { method: 'POST', path: '/api/audio/transcribe', cite: 'web_server.py:1130' },

  // --- messaging platforms (gateway channel config: list + enable/disable + test) ---
  // The Connections surface lists platforms, toggles them, and live-tests a connection.
  // Stock exposes ONLY these three: a list GET, a per-platform PUT (update/enable), and a
  // per-platform test POST. There is NO GET /{platform_id} — do not fabricate one.
  { method: 'GET', path: '/api/messaging/platforms', cite: 'web_server.py:2638' },
  { method: 'PUT', path: '/api/messaging/platforms/{platform_id}', cite: 'web_server.py:2650' },
  {
    method: 'POST',
    path: '/api/messaging/platforms/{platform_id}/test',
    cite: 'web_server.py:2689',
  },

  // --- Connections surface: pairing / webhooks / credential pool (connectionsRoutes.ts) ---
  // Stock device-pairing, webhook subscriptions, and the shared credential pool.
  { method: 'GET', path: '/api/pairing', cite: 'web_server.py:4620' },
  { method: 'POST', path: '/api/pairing/approve', cite: 'web_server.py:4629' },
  { method: 'POST', path: '/api/pairing/revoke', cite: 'web_server.py:4651' },
  { method: 'POST', path: '/api/pairing/clear-pending', cite: 'web_server.py:4665' },
  { method: 'GET', path: '/api/webhooks', cite: 'web_server.py:4712' },
  { method: 'POST', path: '/api/webhooks', cite: 'web_server.py:4728' },
  { method: 'DELETE', path: '/api/webhooks/{name}', cite: 'web_server.py:4780' },
  { method: 'PUT', path: '/api/webhooks/{name}/enabled', cite: 'web_server.py:4797' },
  { method: 'GET', path: '/api/credentials/pool', cite: 'web_server.py:4884' },
  { method: 'POST', path: '/api/credentials/pool', cite: 'web_server.py:4911' },
  {
    method: 'DELETE',
    path: '/api/credentials/pool/{provider}/{index}',
    cite: 'web_server.py:4945',
  },

  { method: 'GET', path: '/api/config/raw', cite: 'web_server.py:3145' },
  { method: 'PUT', path: '/api/config/raw', cite: 'web_server.py:3153' },
  { method: 'GET', path: '/api/analytics/usage', cite: 'web_server.py:3170' },
  { method: 'GET', path: '/api/analytics/models', cite: 'web_server.py:3239' },
  { method: 'GET', path: '/api/dashboard/themes', cite: 'web_server.py:4195' },
  { method: 'PUT', path: '/api/dashboard/theme', cite: 'web_server.py:4230' },
  { method: 'GET', path: '/api/dashboard/plugins', cite: 'web_server.py:4400' },
  { method: 'GET', path: '/api/dashboard/plugins/rescan', cite: 'web_server.py:4415' },
  { method: 'GET', path: '/api/dashboard/plugins/hub', cite: 'web_server.py:4547' },
  { method: 'POST', path: '/api/dashboard/agent-plugins/install', cite: 'web_server.py:4558' },
  {
    method: 'POST',
    path: '/api/dashboard/agent-plugins/{name}/enable',
    cite: 'web_server.py:4587',
  },
  {
    method: 'POST',
    path: '/api/dashboard/agent-plugins/{name}/disable',
    cite: 'web_server.py:4599',
  },
  {
    method: 'POST',
    path: '/api/dashboard/agent-plugins/{name}/update',
    cite: 'web_server.py:4611',
  },
  { method: 'DELETE', path: '/api/dashboard/agent-plugins/{name}', cite: 'web_server.py:4624' },
  { method: 'PUT', path: '/api/dashboard/plugin-providers', cite: 'web_server.py:4642' },
  {
    method: 'POST',
    path: '/api/dashboard/plugins/{name}/visibility',
    cite: 'web_server.py:4662',
  },

  // --- dashboard-auth router (hermes_cli/dashboard_auth/routes.py), mounted at
  // root (web_server.py:4835 app.include_router(_dashboard_auth_router)) ---
  { method: 'GET', path: '/login', cite: 'dashboard_auth/routes.py:126' },
  { method: 'GET', path: '/api/auth/providers', cite: 'dashboard_auth/routes.py:146' },
  { method: 'GET', path: '/auth/login', cite: 'dashboard_auth/routes.py:168' },
  { method: 'GET', path: '/auth/callback', cite: 'dashboard_auth/routes.py:221' },
  { method: 'POST', path: '/auth/logout', cite: 'dashboard_auth/routes.py:371' },
  { method: 'GET', path: '/api/auth/me', cite: 'dashboard_auth/routes.py:407' },
  { method: 'POST', path: '/api/auth/ws-ticket', cite: 'dashboard_auth/routes.py:428' },

  // --- kanban plugin router (plugins/kanban/dashboard/plugin_api.py @router.*),
  // auto-mounted with prefix /api/plugins/kanban (web_server.py:4821) ---
  { method: 'GET', path: '/api/plugins/kanban/board', cite: 'plugin_api.py:369' },
  { method: 'GET', path: '/api/plugins/kanban/tasks/{task_id}', cite: 'plugin_api.py:508' },
  { method: 'POST', path: '/api/plugins/kanban/tasks', cite: 'plugin_api.py:586' },
  {
    method: 'GET',
    path: '/api/plugins/kanban/tasks/{task_id}/attachments',
    cite: 'plugin_api.py:658',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/attachments',
    cite: 'plugin_api.py:674',
  },
  {
    method: 'GET',
    path: '/api/plugins/kanban/attachments/{attachment_id}',
    cite: 'plugin_api.py:749',
  },
  {
    method: 'DELETE',
    path: '/api/plugins/kanban/attachments/{attachment_id}',
    cite: 'plugin_api.py:776',
  },
  { method: 'PATCH', path: '/api/plugins/kanban/tasks/{task_id}', cite: 'plugin_api.py:808' },
  { method: 'DELETE', path: '/api/plugins/kanban/tasks/{task_id}', cite: 'plugin_api.py:931' },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/comments',
    cite: 'plugin_api.py:1078',
  },
  { method: 'POST', path: '/api/plugins/kanban/links', cite: 'plugin_api.py:1104' },
  { method: 'DELETE', path: '/api/plugins/kanban/links', cite: 'plugin_api.py:1117' },
  { method: 'POST', path: '/api/plugins/kanban/tasks/bulk', cite: 'plugin_api.py:1148' },
  { method: 'GET', path: '/api/plugins/kanban/diagnostics', cite: 'plugin_api.py:1251' },
  { method: 'GET', path: '/api/plugins/kanban/workers/active', cite: 'plugin_api.py:1339' },
  { method: 'GET', path: '/api/plugins/kanban/runs/{run_id}', cite: 'plugin_api.py:1400' },
  { method: 'GET', path: '/api/plugins/kanban/runs/{run_id}/inspect', cite: 'plugin_api.py:1422' },
  {
    method: 'POST',
    path: '/api/plugins/kanban/runs/{run_id}/terminate',
    cite: 'plugin_api.py:1494',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/reclaim',
    cite: 'plugin_api.py:1550',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/specify',
    cite: 'plugin_api.py:1588',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/reassign',
    cite: 'plugin_api.py:1641',
  },
  { method: 'GET', path: '/api/plugins/kanban/config', cite: 'plugin_api.py:1680' },
  { method: 'GET', path: '/api/plugins/kanban/home-channels', cite: 'plugin_api.py:1769' },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/home-subscribe/{platform}',
    cite: 'plugin_api.py:1803',
  },
  {
    method: 'DELETE',
    path: '/api/plugins/kanban/tasks/{task_id}/home-subscribe/{platform}',
    cite: 'plugin_api.py:1838',
  },
  { method: 'GET', path: '/api/plugins/kanban/stats', cite: 'plugin_api.py:1867' },
  { method: 'GET', path: '/api/plugins/kanban/assignees', cite: 'plugin_api.py:1883' },
  { method: 'GET', path: '/api/plugins/kanban/tasks/{task_id}/log', cite: 'plugin_api.py:1904' },
  { method: 'POST', path: '/api/plugins/kanban/dispatch', cite: 'plugin_api.py:1944' },
  { method: 'GET', path: '/api/plugins/kanban/boards', cite: 'plugin_api.py:2003' },
  { method: 'POST', path: '/api/plugins/kanban/boards', cite: 'plugin_api.py:2015' },
  { method: 'PATCH', path: '/api/plugins/kanban/boards/{slug}', cite: 'plugin_api.py:2036' },
  { method: 'DELETE', path: '/api/plugins/kanban/boards/{slug}', cite: 'plugin_api.py:2055' },
  { method: 'POST', path: '/api/plugins/kanban/boards/{slug}/switch', cite: 'plugin_api.py:2065' },
  { method: 'GET', path: '/api/plugins/kanban/profiles', cite: 'plugin_api.py:2105' },
  {
    method: 'PATCH',
    path: '/api/plugins/kanban/profiles/{profile_name}',
    cite: 'plugin_api.py:2135',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/profiles/{profile_name}/describe-auto',
    cite: 'plugin_api.py:2168',
  },
  {
    method: 'POST',
    path: '/api/plugins/kanban/tasks/{task_id}/decompose',
    cite: 'plugin_api.py:2204',
  },
  { method: 'GET', path: '/api/plugins/kanban/orchestration', cite: 'plugin_api.py:2258' },
  { method: 'PUT', path: '/api/plugins/kanban/orchestration', cite: 'plugin_api.py:2301' },
] as const

/**
 * The frozen membership set, keyed `METHOD /normalised/path`. This is what the
 * conformance test checks BFF calls against.
 */
export const KNOWN_HERMES_ROUTES: ReadonlySet<string> = new Set(
  ROUTES.map((r) => routeKey(r.method, r.path)),
)

/** The route records (method + path + cite), for diagnostics/reporting. */
export const KNOWN_HERMES_ROUTE_LIST: readonly KnownHermesRoute[] = ROUTES
