import { test, expect } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC terminal-DOCK e2e — drives the single-session terminal that lives in
 * the right side-panel slot (the SAME slot the Preview + Work panels share, kept
 * mutually exclusive). No live backend: every `/api/agent-deck/**` REST call is
 * stubbed at the browser network layer via `page.route()`, so these specs are
 * deterministic regardless of whether the gateway/dashboard is up. They run
 * against the mock web instance (:5199), reusing the chat project's webServer pair.
 *
 * The dock toggle (`data-testid="terminal-dock-toggle"`) is in the chat chrome
 * and only renders when the server reports the terminal ENABLED (health
 * `bind.terminalEnabled`) AND at sm+ width (it sheds below `sm`). The default
 * Playwright viewport (1280×720) clears both gates, so no resize is needed.
 *
 * Terminal-availability gating: the dock's content is driven by the
 * `/api/agent-deck/terminal/status` probe, which we STUB here — so we don't depend
 * on whether node-pty actually built in the hermetic env. We exercise BOTH paths
 * explicitly: the "available" stub opens the dock to its real-shell consent gate
 * (we stop there — never mounting xterm / dialing a socket, exactly like
 * terminal.spec.ts), and the "unavailable" stub asserts the honest panel. The
 * full keystroke→pty round-trip is covered by the injected-socket unit tests.
 */

const HEALTH = {
  status: 'ok',
  hermes: {
    reachable: true,
    endpoint: 'http://127.0.0.1:8643',
    platform: 'hermes-agent',
  },
  // terminalEnabled drives whether the dock toggle renders at all.
  bind: { remote: false, terminalEnabled: true, authRequired: false },
  version: '0.1.0',
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Stub every `/api/agent-deck/**` REST call so no live BFF/dashboard is hit. The
 * caller passes the terminal-status payload for the path under test; everything
 * else (health, the rail's organization/sessions/models probes) gets a
 * well-formed empty/healthy response so the chat chrome mounts console-clean.
 *
 * NOTE: the terminal status branch is matched BEFORE the catch-all so the dock's
 * availability probe deterministically takes the supplied path.
 */
async function stubBff(page: Page, terminalStatus: Record<string, unknown>) {
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname

    if (path.endsWith('/terminal/status')) return json(route, terminalStatus)
    if (path.endsWith('/health')) return json(route, HEALTH)
    if (path.endsWith('/models')) return json(route, { provider: {}, models: [] })
    // The rail's organization store drives render-time Object.values(assignments),
    // so it MUST be a well-formed empty store (the catch-all {} would crash it).
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, { sessions: [] })
    // Anything else: a harmless empty 200 so a stray probe never 404-noises.
    return json(route, {})
  })
}

/** Collect console + page errors so each test can assert it stayed clean. */
function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/** The "available" terminal-status payload — opens the dock to its consent gate. */
const STATUS_AVAILABLE = { available: true, cwd_available: true }

test('Terminal dock: the toggle opens the dock in the side panel, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubBff(page, STATUS_AVAILABLE)
  await page.goto('/chat')

  // The toggle lives in the chat chrome (gated on terminalEnabled + sm+ width).
  const toggle = page.getByTestId('terminal-dock-toggle')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-label', 'Open terminal')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  // The dock region only mounts while the dock is open.
  const dock = page.getByRole('region', { name: 'Terminal dock' })
  await expect(dock).toHaveCount(0)

  await toggle.click()

  // Open: the dock region mounts in the side panel and the toggle flips state.
  await expect(dock).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveAttribute('aria-label', 'Close terminal')

  // With the "available" probe the dock lands on the real-shell consent gate
  // (the dock's own copy) BEFORE any socket/pty — mirror terminal.spec and stop
  // here so we never mount xterm or dial a live namespace in the hermetic env.
  await expect(dock.getByText('A quick heads-up first')).toBeVisible()
  await expect(dock.getByRole('button', { name: /Got it, open the terminal/i })).toBeVisible()

  // Toggling again closes the dock (the parked shell id lives on; the region unmounts).
  await toggle.click()
  await expect(dock).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  expect(errors).toEqual([])
})

test('Terminal dock: opening it closes the Preview panel (mutual exclusion), console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubBff(page, STATUS_AVAILABLE)
  await page.goto('/chat')

  // Open the Preview panel via its header toggle (Globe). With nothing else open,
  // this opens the in-app iframe browser into the single side-panel slot.
  const previewToggle = page.getByTestId('preview-toggle')
  await expect(previewToggle).toBeVisible()
  await previewToggle.click()

  const previewDrawer = page.getByTestId('preview-drawer')
  await expect(previewDrawer).toHaveAttribute('data-open', 'true')

  // Opening the dock must EVICT the preview from the shared slot (the dock store
  // closes its siblings on open).
  const dock = page.getByRole('region', { name: 'Terminal dock' })
  await page.getByTestId('terminal-dock-toggle').click()

  await expect(dock).toBeVisible()
  // The single side-panel slot stays open — its OCCUPANT swapped from the preview
  // browser to the dock. Mutual exclusion is about WHICH panel shows in the shared
  // slot, not collapsing the slot, so the drawer stays open and the preview content
  // is hidden behind the dock.
  await expect(previewDrawer).toHaveAttribute('data-open', 'true')
  await expect(page.getByTestId('preview-panel')).toBeHidden()

  expect(errors).toEqual([])
})

test('Terminal dock: opening the Preview panel closes the dock (reverse exclusion), console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubBff(page, STATUS_AVAILABLE)
  await page.goto('/chat')

  // Open the dock first.
  const toggle = page.getByTestId('terminal-dock-toggle')
  await toggle.click()
  const dock = page.getByRole('region', { name: 'Terminal dock' })
  await expect(dock).toBeVisible()

  // While the dock holds the slot, the single side-panel toggle (Globe) is wired
  // to close the active occupant — so clicking it evicts the dock. Either way the
  // invariant holds: the dock and the preview never co-occupy the slot.
  await page.getByTestId('preview-toggle').click()
  await expect(dock).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  expect(errors).toEqual([])
})

test('Terminal dock: the header carries an "Open full Terminal" link to /terminal, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubBff(page, STATUS_AVAILABLE)
  await page.goto('/chat')

  await page.getByTestId('terminal-dock-toggle').click()
  const dock = page.getByRole('region', { name: 'Terminal dock' })
  await expect(dock).toBeVisible()

  // The bridge to the multi-terminal power tool is a REAL route link, not a fake.
  const fullLink = dock.getByRole('link', { name: 'Open full Terminal' })
  await expect(fullLink).toBeVisible()
  await expect(fullLink).toHaveAttribute('href', '/terminal')

  expect(errors).toEqual([])
})

test('Terminal dock: a node-pty-less host shows the honest "Terminal unavailable" panel, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  // The honest "unavailable" path (node-pty missing) must degrade calmly — no
  // consent gate, no socket, just the calm panel.
  await stubBff(page, {
    available: false,
    reason: 'The terminal backend (node-pty) is not available on this host.',
  })
  await page.goto('/chat')

  await page.getByTestId('terminal-dock-toggle').click()
  const dock = page.getByRole('region', { name: 'Terminal dock' })
  await expect(dock).toBeVisible()

  await expect(dock.getByText('Terminal unavailable')).toBeVisible()
  // The scary real-shell consent gate must NOT precede a spawn that would fail.
  await expect(dock.getByText('A quick heads-up first')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('Terminal dock: the toggle is hidden when the server reports the terminal disabled', async ({
  page,
}) => {
  const errors = trackConsole(page)
  // A remote bind / no node-pty reports terminalEnabled=false; the toggle must be
  // honestly absent (never a dead button) rather than open a dock that can't work.
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const body = (b: unknown) => json(route, b)
    if (path.endsWith('/health'))
      return body({ ...HEALTH, bind: { ...HEALTH.bind, terminalEnabled: false } })
    if (path.endsWith('/models')) return body({ provider: {}, models: [] })
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return body({ projects: [], assignments: {} })
    if (path.endsWith('/organization')) return body({ projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return body({ results: [] })
    if (path.endsWith('/sessions')) return body({ sessions: [] })
    return body({})
  })
  await page.goto('/chat')

  // The chat chrome is up (the burn-rate pill shares the header accessory slot),
  // but the dock toggle is honestly absent.
  await expect(page.getByTestId('header-slot')).toBeVisible()
  await expect(page.getByTestId('terminal-dock-toggle')).toHaveCount(0)

  expect(errors).toEqual([])
})
