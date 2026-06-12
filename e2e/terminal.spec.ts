import { test, expect } from './fixtures'
import type { Page, ConsoleMessage } from '@playwright/test'

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
 * HERMETIC terminal e2e — opens the Terminal surface and asserts it renders +
 * stays CONSOLE-CLEAN with NO live backend.
 *
 * Transport note: the terminal is driven over a Socket.IO namespace
 * (`/agent-deck-terminal`), not REST, so it can't be stubbed with `page.route()`
 * the way the other surfaces are. We stub the status probe
 * (`/api/agent-deck/terminal/status`) to the "available" path so the surface
 * deterministically mounts the xterm engine and opens a session; with no backend
 * the namespace simply never connects, which the UI surfaces as a calm status
 * dot (NOT a console error) — so the console-clean invariant still holds. The
 * full keystroke→pty→output round-trip is covered hermetically by the
 * injected-socket unit tests (TerminalView.test.tsx / terminalSocket.test.ts);
 * exercising it in a real browser requires a mock-pty BFF (server-side, out of
 * this surface's scope).
 */

function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Catch-all stub for the dashboard-backed REST the AppShell rail fires on every
 * route's load (model picker, sessions list, status/config). Registered FIRST so
 * each test's specific `/terminal/status` route takes precedence (Playwright runs
 * handlers in reverse-registration order); everything else falls here. Keeps the
 * Terminal surface console-clean whether or not the hermes dashboard (:9123) is
 * up — the terminal namespace itself is socket-driven and unaffected.
 */
async function stubDashboardRest(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const fulfill = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    if (path.endsWith('/health')) return fulfill(HEALTH)
    if (path.endsWith('/models')) return fulfill({ provider: {}, models: [] })
    // The rail's organization store (drives render-time Object.values) must be a
    // well-formed empty store, not the catch-all {} below.
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return fulfill({ projects: [], assignments: {} })
    if (path.endsWith('/organization')) return fulfill({ projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return fulfill({ results: [] })
    if (path.endsWith('/sessions')) return fulfill({ sessions: [] })
    return fulfill({})
  })
}

test('Terminal: opens the xterm surface, console-clean', async ({ page }) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)

  // Force the "available" path so the surface mounts the terminal deterministically.
  await page.route('**/api/agent-deck/terminal/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: true }),
    }),
  )
  // The launcher fetches the installed-CLI list; stub a raw shell as available.
  await page.route('**/api/agent-deck/terminal/clis', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ clis: [{ id: 'shell', label: 'Raw shell', available: true }] }),
    }),
  )
  // The persistence probe: this host has no tmux, so the launcher must say
  // honestly that shells will not survive disconnects.
  await page.route('**/api/agent-deck/terminal/sessions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tmuxAvailable: false, sessions: [] }),
    }),
  )

  await page.goto('/terminal')

  // First open shows the real-shell acknowledge gate BEFORE any socket/pty.
  // Match the GATE copy specifically (the surface subtitle now also mentions a
  // "real shell on the host", so anchor on the gate's distinctive sentence).
  await expect(page.getByRole('heading', { name: 'Terminal' })).toBeVisible()
  await expect(page.getByText(/This is a real shell on the host/i)).toBeVisible()
  await expect(page.getByTestId('terminal-host')).toHaveCount(0)

  // Acknowledge → the "Launch an agent" launcher appears (choose a CLI), with
  // the honest no-tmux persistence line.
  await page.getByRole('button', { name: /open the terminal/i }).click()
  await expect(page.getByText(/Launch an agent/i)).toBeVisible()
  await expect(
    page.getByText('Shells on this host are not persistent (tmux not installed).'),
  ).toBeVisible()

  // Pick the raw shell → the lazily-mounted xterm host appears.
  await page.getByRole('button', { name: /Launch the Raw shell/i }).click()
  await expect(page.getByTestId('terminal-host')).toBeVisible()

  expect(errors).toEqual([])
})

test('Terminal: a node-pty-less host shows the calm unavailable panel, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)

  // The honest "unavailable" path (node-pty missing) must degrade calmly.
  await page.route('**/api/agent-deck/terminal/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: false,
        reason: 'The terminal backend (node-pty) is not available on this host.',
      }),
    }),
  )

  await page.goto('/terminal')

  await expect(page.getByRole('heading', { name: 'Terminal' })).toBeVisible()
  await expect(page.getByText('Terminal unavailable')).toBeVisible()

  expect(errors).toEqual([])
})
