import { test, expect } from './fixtures'
import type { Page, ConsoleMessage, Route, Response } from '@playwright/test'

/**
 * HERMETIC all-route smoke — shallow-render EVERY nav route and lock in the
 * route cleanliness invariant in the default gate.
 *
 * For each route this asserts, with NO live backend:
 *   - the surface's expected heading / landmark renders (it actually mounted),
 *   - NO uncaught pageerror,
 *   - NO console error OR warning,
 *   - no local 4xx/5xx response from our own origin.
 *
 * Voice/Messaging/MCP folded into the ONE tabbed Connections surface, so the
 * `/voice` · `/messaging` · `/mcp` paths REDIRECT to `/connections?tab=…`; a
 * dedicated block below asserts those redirects land on the right tab and that
 * the demoted-but-routed `/system` + `/logs` stay reachable directly. So nothing
 * was made unreachable by the rail consolidation.
 *
 * Every `/api/agent-deck/**` REST call the pages make is stubbed at the browser
 * network layer via `page.route()` with VALID-shaped, healthy payloads (parsed
 * by the protocol DTOs the hooks run), so each surface renders its real happy
 * state rather than a degraded error card — and the spec is deterministic
 * regardless of whether the gateway or dashboard is running. It runs against the
 * mock web instance (:5199), sharing the chat project's webServer pair, and never
 * calls the real gateway/dashboard or depends on live Hermes state.
 *
 * Companion to `surfaces.spec.ts` (which drives the per-surface INTERACTIONS —
 * open a session, browse a file, switch a model). This spec is the breadth pass:
 * one shallow render of every route, so a regression that breaks any single
 * route's first paint is caught by the default `pnpm e2e`.
 */

const NOW = Math.floor(Date.now() / 1000)
const ISO = new Date(NOW * 1000).toISOString()

const HEALTH = {
  status: 'ok',
  hermes: {
    reachable: true,
    endpoint: 'http://127.0.0.1:8643',
    platform: 'hermes-agent',
  },
  bind: { remote: false, terminalEnabled: true, authRequired: false },
  version: '0.1.0',
}

/* -------------------------------------------------------------------------- */
/* Valid, healthy payloads — one per BFF read each surface makes.             */
/* Shapes track the protocol DTOs (packages/protocol/src/*) the hooks parse.  */
/* -------------------------------------------------------------------------- */

const SESSIONS = {
  total: 1,
  sessions: [
    {
      id: 'sess-1',
      source: 'cli',
      model: 'anthropic/claude-sonnet-4',
      title: 'Refactor the parser',
      preview: 'help me refactor',
      started_at: NOW,
      last_active: NOW,
      message_count: 2,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cost_usd: 0.01,
      is_active: false,
    },
  ],
}

const FILE_ROOTS = {
  roots: [
    {
      id: 'workspace',
      label: 'Workspace',
      description: 'Your active workspace',
      path: '/home/agent/workspace',
      readOnly: false,
    },
  ],
}

const FILE_LISTING = {
  root: 'workspace',
  path: '',
  truncated: false,
  entries: [
    {
      name: 'README.md',
      path: 'README.md',
      type: 'file',
      modified: ISO,
      size: 42,
      suppressed: false,
      reason: null,
      preview: 'full',
    },
  ],
}

const MODELS = {
  activeModelId: 'anthropic/claude-sonnet-4',
  provider: { id: 'anthropic', label: 'Anthropic' },
  reasoningEffort: 'medium',
  scope: 'global',
  hasChannelOverride: false,
  models: [
    {
      id: 'anthropic/claude-sonnet-4',
      label: 'Claude Sonnet 4',
      provider: 'anthropic',
      active: true,
      source: 'config',
    },
  ],
}

const PROFILES = {
  active: 'default',
  profiles: [
    {
      name: 'default',
      path: '/home/agent/.hermes/profiles/default',
      isDefault: true,
      isActive: true,
      model: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
      hasEnv: true,
      skillCount: 3,
      gatewayRunning: false,
    },
  ],
}

const SETTINGS = {
  editable: false,
  sections: [
    {
      category: 'gateway',
      fields: [
        {
          key: 'gateway.port',
          label: 'port',
          description: 'The port the hermes gateway listens on.',
          type: 'number',
          value: 8643,
          isSecret: false,
        },
      ],
    },
  ],
}

const USAGE = {
  periodDays: 7,
  totals: {
    inputTokens: 12000,
    outputTokens: 4000,
    cacheReadTokens: 800,
    reasoningTokens: 200,
    estimatedCost: 0.42,
    actualCost: 0.4,
    sessions: 5,
  },
  daily: [
    {
      day: ISO.slice(0, 10),
      inputTokens: 12000,
      outputTokens: 4000,
      cacheReadTokens: 800,
      reasoningTokens: 200,
      estimatedCost: 0.42,
      actualCost: 0.4,
      sessions: 5,
    },
  ],
  byModel: [
    {
      model: 'anthropic/claude-sonnet-4',
      inputTokens: 12000,
      outputTokens: 4000,
      estimatedCost: 0.42,
      sessions: 5,
    },
  ],
}

/** Cross-source status (`AgentDeckStatus`) — gateway down but well-formed. */
const STATUS = {
  gatewayRunning: false,
  gatewayState: 'stopped',
  platforms: [],
  activeSessions: 0,
  version: '0.0.0',
  configUpdateAvailable: false,
}

/** Maintenance dock (`SystemState`) — fail-closed resting values. */
const SYSTEM = {
  gateway: { status: 'stopped' },
  hermes: { status: 'up-to-date', currentVersion: '0.0.0' },
  agentDeck: { status: 'no-channel', currentVersion: '0.1.0' },
}

/** Cron jobs (`CronJobList`) — empty but valid → the honest "No scheduled jobs". */
const CRON_JOBS = { jobs: [] }

/** Logs (`AgentDeckLogs`) — empty but valid → the honest "Nothing logged yet". */
const LOGS = { file: 'agent', entries: [], truncated: false }

/** Kanban — the honest "plugin not enabled" availability shape (no live socket data needed). */
const KANBAN_UNAVAILABLE = { available: false }

/** Messaging (`MessagingState`) — gateway down, no platforms configured. */
const MESSAGING = { platforms: [], gatewayRunning: false }

/** MCP (`McpState`) — no servers, empty catalog. */
const MCP = { servers: [], catalog: [] }

/** Toolsets (`AgentDeckToolsetsResponse`) — one enabled toolset with its tools. */
const TOOLSETS = {
  toolsets: [
    {
      name: 'web',
      label: 'Web Search & Scraping',
      description: 'web_search, web_extract',
      enabled: true,
      configured: true,
      tools: ['web_search', 'web_extract'],
    },
  ],
}

/** A shape-only key field (local provider → no key needed). */
const LOCAL_KEY = { envVar: null, label: 'No key needed', isSet: false, redactedValue: null }

/** Voice (`VoiceState`) — one local TTS + the local STT provider, no keys needed. */
const VOICE = {
  ttsProvider: 'edge',
  sttProvider: 'local',
  sttEnabled: true,
  ttsProviders: [
    {
      id: 'edge',
      label: 'Edge',
      local: true,
      voiceField: 'voice',
      voiceLabel: 'Voice',
      voice: '',
      key: LOCAL_KEY,
      note: 'No key needed',
    },
  ],
  sttProviders: [
    {
      id: 'local',
      label: 'Local',
      local: true,
      key: LOCAL_KEY,
      note: 'No key needed — runs on-device',
    },
  ],
  toggles: { autoTts: false, beepEnabled: false },
}

/** Recent voice notes (`AudioNoteList`) — none yet. */
const AUDIO_NOTES = { notes: [], truncated: false }

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Stub every `/api/agent-deck/**` REST call with a VALID, healthy payload so no
 * live BFF/dashboard is hit and each surface renders its real (non-error) state.
 * The order matters: more-specific suffixes are matched before bare ones.
 */
async function stubBff(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path.endsWith('/health')) return json(route, HEALTH)

    // Organization (Agent Deck's own project/tag store). The rail's
    // `['organization']` query drives render-time `Object.values(assignments)`,
    // so it MUST resolve to a well-formed store — a bare `{}` would crash the rail.
    if (path.endsWith('/organization') && !path.includes('/sessions/')) {
      return json(route, { projects: [], assignments: {} })
    }
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })

    // Sessions
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, SESSIONS)

    // Files
    if (path.endsWith('/files/roots')) return json(route, FILE_ROOTS)
    if (path.endsWith('/files')) return json(route, FILE_LISTING)

    // Models / Profiles / Settings
    if (path.endsWith('/models')) return json(route, MODELS)
    if (path.endsWith('/profiles')) return json(route, PROFILES)
    if (path.endsWith('/config')) return json(route, SETTINGS)

    // Usage (carries a ?days= query)
    if (path.endsWith('/usage')) return json(route, USAGE)

    // Cross-source status + Maintenance dock
    if (path.endsWith('/status')) return json(route, STATUS)
    if (path.endsWith('/system')) return json(route, SYSTEM)

    // Operations: cron jobs + logs
    if (path.endsWith('/cron/jobs')) return json(route, CRON_JOBS)
    if (path.includes('/logs')) return json(route, LOGS)

    // Kanban — board + board-list both report the honest "not enabled" shape.
    if (path.endsWith('/kanban/board') || path.endsWith('/kanban/boards')) {
      return json(route, KANBAN_UNAVAILABLE)
    }

    // Agent group: messaging / mcp / tools / voice (+ voice audio notes)
    if (path.endsWith('/messaging')) return json(route, MESSAGING)
    if (path.endsWith('/mcp')) return json(route, MCP)
    if (path.endsWith('/toolsets')) return json(route, TOOLSETS)
    if (path.endsWith('/voice/audio')) return json(route, AUDIO_NOTES)
    if (path.endsWith('/voice')) return json(route, VOICE)

    // Terminal availability (the Terminal surface probes this before the PTY socket).
    if (path.endsWith('/terminal/status')) {
      return json(route, { enabled: true, reason: null, cwd: '/home/agent/workspace' })
    }
    if (path.endsWith('/terminal/clis')) return json(route, { clis: [] })

    // Anything else: a harmless empty 200 so a stray probe never 404-noises.
    return json(route, {})
  })
}

/**
 * Collect console errors + warnings + page errors + local 4xx/5xx responses so
 * each route can assert it stayed fully clean. Same-origin only — the page's own
 * 4xx/5xx, not a stubbed third-party.
 */
/**
 * Benign, ENVIRONMENTAL console noise that is expected with NO live backend and
 * is NOT a code defect — a live socket.io surface (Kanban's board stream) tries
 * to open a WebSocket that never connects in the hermetic test, which the browser
 * reports as a `WebSocket connection … failed` warning. The UI itself degrades
 * honestly to a calm "offline" dot; the warning is the browser's, not ours. We do
 * NOT swallow our own code's warnings/errors — only this transport-layer notice.
 */
const BENIGN_CONSOLE = /WebSocket (connection|is closed before the connection)/i

function trackCleanliness(page: Page, originHost: string): string[] {
  const problems: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    const type = m.type()
    if (type !== 'error' && type !== 'warning') return
    const text = m.text()
    if (BENIGN_CONSOLE.test(text)) return
    problems.push(`console.${type}: ${text}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  page.on('response', (res: Response) => {
    const status = res.status()
    if (status < 400) return
    const url = new URL(res.url())
    // Only OUR origin's responses — a stubbed external probe is not our concern.
    if (url.host !== originHost) return
    problems.push(`http ${status}: ${url.pathname}`)
  })
  return problems
}

test.beforeEach(async ({ page }) => {
  await stubBff(page)
})

/**
 * Every NAV route × its expected first-paint anchor. The anchor is the heading
 * or landmark that proves the surface mounted (an h1, a labelled landmark, or a
 * stable test id). Mirrors `app/navigation.tsx` — keep in lockstep when routes
 * change so the gate fails loudly on a new route that isn't smoked.
 */
const ROUTES: { path: string; anchor: (page: Page) => Promise<void> }[] = [
  {
    // Home (/) — the front door. The hero h1 is "Agent Deck" (or "Meet <name>"
    // once an agent is named); with the stubbed default profile it reads "Meet".
    path: '/',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: /Agent Deck|Meet |Welcome/i })).toBeVisible()
    },
  },
  {
    // Chat (/chat) — the conversation surface uses the split rail: a sessions
    // pane + the composer textarea landmark (no PageHeader h1 of its own).
    path: '/chat',
    anchor: async (page) => {
      await expect(page.getByTestId('sessions-pane')).toBeVisible()
      await expect(page.getByRole('textbox', { name: /Message your agent/i })).toBeVisible()
    },
  },
  {
    path: '/history',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
    },
  },
  {
    // Kanban's surface header was renamed "Board" (route path stays /kanban).
    path: '/kanban',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
    },
  },
  {
    path: '/files',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
    },
  },
  {
    path: '/terminal',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Terminal' })).toBeVisible()
    },
  },
  {
    // The Jobs/Cron surface header was renamed "Tasks" (route path stays /jobs).
    path: '/jobs',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
    },
  },
  {
    path: '/profiles',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: /Agents/i })).toBeVisible()
    },
  },
  {
    path: '/tools',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible()
    },
  },
  {
    // Connections — the folded tabbed home for Voice · Messaging · MCP. The
    // tablist renders + the default Voice tab's surface (its own PageHeader)
    // mounts inside the panel.
    path: '/connections',
    anchor: async (page) => {
      await expect(page.getByRole('tablist', { name: /connections/i })).toBeVisible()
      await expect(page.getByRole('tab', { name: /voice/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Voice' })).toBeVisible()
    },
  },
  {
    path: '/usage',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
    },
  },
  {
    path: '/logs',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible()
    },
  },
  {
    path: '/system',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'System' })).toBeVisible()
    },
  },
  {
    path: '/settings',
    anchor: async (page) => {
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    },
  },
]

for (const { path, anchor } of ROUTES) {
  test(`route ${path} renders + stays clean (no error/warning, no 4xx/5xx)`, async ({
    page,
    baseURL,
  }) => {
    const originHost = new URL(baseURL ?? 'http://127.0.0.1:5199').host
    const problems = trackCleanliness(page, originHost)
    await page.goto(path)
    await anchor(page)
    expect(problems, `route ${path} surfaced console/page/http problems`).toEqual([])
  })
}

/**
 * Consolidation guarantees — NOTHING the rail dropped became unreachable.
 *
 * The old standalone surfaces redirect into Connections (right tab) so deep-links
 * + Settings' "Configured on the X page →" still land; the demoted System + Logs
 * stay directly reachable (they're also in ⌘K + a Settings "Maintenance & logs"
 * link, covered by unit tests).
 */
const TAB_REDIRECTS: { from: string; tab: string; heading: RegExp }[] = [
  { from: '/voice', tab: 'voice', heading: /^Voice$/ },
  { from: '/messaging', tab: 'messaging', heading: /^Messaging$/ },
  { from: '/mcp', tab: 'mcp', heading: /^Integrations \(MCP\)$/ },
]

for (const { from, tab, heading } of TAB_REDIRECTS) {
  test(`${from} redirects to /connections?tab=${tab} and lands on the right tab`, async ({
    page,
  }) => {
    await page.goto(from)
    // The URL settles on the Connections surface with the matching ?tab=.
    await expect(page).toHaveURL(new RegExp(`/connections\\?tab=${tab}$`))
    // The matching tab is selected and that surface's own header is mounted.
    // Select by the tab's stable id — the MCP tab's label is "Integrations" (no
    // "MCP"), so matching by accessible name would miss it.
    await expect(page.locator(`#connections-tab-${tab}`)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  })
}

test('the demoted System + Logs surfaces are still reachable directly', async ({ page }) => {
  await page.goto('/system')
  await expect(page.getByRole('heading', { name: 'System' })).toBeVisible()
  await page.goto('/logs')
  await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible()
})

test('/models redirects to /settings and the model picker is reachable there', async ({ page }) => {
  await page.goto('/models')
  // The standalone Models page was demoted to a Settings section; the deep-link
  // settles on Settings and the model picker (its rows) renders there.
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('[data-testid^="model-row-"]').first()).toBeVisible()
})
