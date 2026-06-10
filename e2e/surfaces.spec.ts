import { test, expect } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

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

/**
 * HERMETIC cross-surface e2e — every secondary surface renders + stays
 * CONSOLE-CLEAN with NO live backend. The BFF/dashboard is never actually hit:
 * all `/api/agent-deck/**` REST calls are stubbed at the browser network layer
 * via `page.route()`, so these specs are deterministic regardless of whether the
 * gateway or dashboard is running. They run against the mock web instance
 * (:5199), reusing the chat project's webServer pair.
 *
 * Coverage: Sessions (open a session → real transcript), Files (browse + open a
 * file), Models, Profiles, Settings, Usage. The Terminal surface and the
 * cross-session Continue/resume loop have their own specs (terminal.spec.ts,
 * resume.spec.ts) for their distinct transport stories.
 */

const NOW = Math.floor(Date.now() / 1000)

const SESSIONS = {
  total: 1,
  sessions: [
    {
      id: 'sess-1',
      source: 'web',
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

const SESSION_DETAIL = {
  ...SESSIONS.sessions[0],
  ended_at: NOW,
  end_reason: 'completed',
  tool_call_count: 0,
}

const SESSION_MESSAGES = {
  session_id: 'sess-1',
  messages: [
    {
      id: '1',
      role: 'user',
      content: 'refactor the parser please',
      timestamp: NOW,
      reasoning: null,
      tool_name: null,
      tool_calls: [],
    },
    {
      id: '2',
      role: 'assistant',
      content: 'Sure, here is the plan.',
      timestamp: NOW,
      reasoning: null,
      tool_name: null,
      tool_calls: [],
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
      modified: new Date(NOW * 1000).toISOString(),
      size: 42,
      suppressed: false,
      reason: null,
      preview: 'full',
    },
  ],
}

const FILE_CONTENT = {
  root: 'workspace',
  path: 'README.md',
  content: '# Hello from the mock workspace\n\nThis file is served hermetically.',
  encoding: 'utf-8',
  size: 42,
  modified: new Date(NOW * 1000).toISOString(),
  mime: 'text/markdown',
  previewMode: 'full',
  truncated: false,
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
    {
      id: 'openai/gpt-5',
      label: 'GPT-5',
      provider: 'openai',
      active: false,
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
        {
          key: 'gateway.api_key',
          label: 'api_key',
          description: 'Gateway API key (redacted).',
          type: 'string',
          value: '••••••••',
          isSecret: true,
        },
      ],
    },
  ],
}

function usagePayload(days: number) {
  return {
    periodDays: days,
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
        day: new Date(NOW * 1000).toISOString().slice(0, 10),
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
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/** Stub every `/api/agent-deck/**` REST call so no live BFF/dashboard is hit. */
async function stubBff(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path.endsWith('/health')) return json(route, HEALTH)

    // Organization (Agent Deck's own project/tag store). The rail's
    // `['organization']` query drives render-time `Object.values(assignments)`,
    // so it MUST resolve to a well-formed store (an empty one is fine here) — the
    // earlier catch-all `{}` stub would crash the rail. Match the session-scoped
    // PUT (`/sessions/:id/organization`) before the bare `/sessions` checks.
    if (path.endsWith('/organization') && !path.includes('/sessions/')) {
      return json(route, { projects: [], assignments: {} })
    }
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })

    // Sessions
    if (path.endsWith('/sessions/sess-1/messages')) return json(route, SESSION_MESSAGES)
    if (path.endsWith('/sessions/sess-1')) return json(route, SESSION_DETAIL)
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, SESSIONS)

    // Files
    if (path.endsWith('/files/roots')) return json(route, FILE_ROOTS)
    if (path.endsWith('/files/read')) return json(route, FILE_CONTENT)
    if (path.endsWith('/files')) return json(route, FILE_LISTING)

    // Models / Profiles / Settings
    if (path.endsWith('/models')) return json(route, MODELS)
    if (path.endsWith('/profiles')) return json(route, PROFILES)
    if (path.endsWith('/config')) return json(route, SETTINGS)

    // Usage (carries a ?days= query)
    if (path.endsWith('/usage')) {
      const days = Number(url.searchParams.get('days') ?? '7')
      return json(route, usagePayload(days))
    }

    // Anything else: a harmless empty 200 so a stray probe never 404-noises.
    return json(route, {})
  })
}

/** Collect console errors + page errors so each surface can assert it stayed clean. */
function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.beforeEach(async ({ page }) => {
  await stubBff(page)
})

test('Sessions: open a session from the rail → real transcript renders, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  // The dedicated sessions pane lives on the Chat surface (split rail).
  await page.goto('/chat')

  // The sessions pane lists the (stubbed) web session. §1 — a row CLICK now
  // RESUMES in place; the read-only transcript is the row's SECONDARY
  // "View transcript" overflow action, so reach it from there.
  const row = page.getByRole('button', { name: /^Refactor the parser/ })
  await expect(row).toBeVisible()
  await row.hover()
  await page.getByRole('button', { name: /^More actions for Refactor the parser/ }).click()
  await page.getByRole('menuitem', { name: /View transcript/i }).click()

  // The read-only transcript renders the real messages via the chat vocabulary,
  // with the renamed "Resume" affordance to continue the session live.
  await expect(page.getByRole('heading', { name: 'Refactor the parser' })).toBeVisible()
  await expect(page.getByText('refactor the parser please')).toBeVisible()
  await expect(page.getByText('Sure, here is the plan.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Resume$/ })).toBeVisible()

  expect(errors).toEqual([])
})

test('Files: browse the workspace + open a file, console-clean', async ({ page }) => {
  const errors = trackConsole(page)
  await page.goto('/files')

  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()

  // The mock listing shows README.md; open it and assert the preview renders.
  const entry = page.getByText('README.md').first()
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByText(/Hello from the mock workspace/)).toBeVisible()

  expect(errors).toEqual([])
})

test('Models: the configured models render in the Settings model section, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  // Models was demoted from a rail surface to a Settings section; the model
  // picker (and its rows) now lives on /settings.
  await page.goto('/settings')

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByTestId('model-row-anthropic/claude-sonnet-4')).toBeVisible()
  await expect(page.getByText('Claude Sonnet 4')).toBeVisible()

  expect(errors).toEqual([])
})

test('Agents: renders the agent cards, console-clean', async ({ page }) => {
  const errors = trackConsole(page)
  await page.goto('/profiles')

  await expect(page.getByRole('heading', { name: /Agents/i })).toBeVisible()
  await expect(page.getByTestId('profile-card-default')).toBeVisible()

  expect(errors).toEqual([])
})

test('Settings: renders the (read-only) config sections, console-clean', async ({ page }) => {
  const errors = trackConsole(page)
  await page.goto('/settings')

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('gateway', { exact: false }).first()).toBeVisible()

  expect(errors).toEqual([])
})

test('Usage: renders the usage summary, console-clean', async ({ page }) => {
  const errors = trackConsole(page)
  await page.goto('/usage')

  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()

  expect(errors).toEqual([])
})
