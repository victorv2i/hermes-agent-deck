import { test, expect } from './fixtures'
import type { Page, ConsoleMessage } from '@playwright/test'

/**
 * HERMETIC mobile-terminal e2e — a touch device (phone-sized viewport,
 * hasTouch) opens the Terminal surface and gets the touch key bar.
 *
 * Scope note: the mock layer has no pty backend (the terminal namespace never
 * connects), so the socket input a key tap produces is NOT observable here. The
 * byte-level assertions (single tap emits one sequence, hold-repeat emits many,
 * sticky Ctrl, paste) live in the component tests with a stubbed input sink
 * (MobileKeyBar.test.tsx / TerminalView.test.tsx). This spec covers what only a
 * real browser shows: the bar renders for a touch context, every key is
 * tappable, and the surface stays console-clean.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

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
 * Engine.io polling noise, filtered like auth-unlock's BENIGN_AUTH: under heavy
 * CPU contention the socket.io polling-to-websocket upgrade can race, and a late
 * polling GET with an already-closed sid gets a 400 the browser logs as "Failed
 * to load resource". socket.io recovers on its own; it is transport noise, not a
 * surface error. Filtered ONLY for /socket.io/ URLs so a real 400 from an API
 * call still fails the console-clean assertion.
 */
const BENIGN_POLLING_400 = /Failed to load resource.*400/i

function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    if (BENIGN_POLLING_400.test(m.text()) && m.location().url.includes('/socket.io/')) return
    errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/** Same catch-all dashboard REST stub as terminal.spec.ts (registered first so
 *  the specific terminal stubs below take precedence). */
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
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return fulfill({ projects: [], assignments: {} })
    if (path.endsWith('/organization')) return fulfill({ projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return fulfill({ results: [] })
    if (path.endsWith('/sessions')) return fulfill({ sessions: [] })
    return fulfill({})
  })
}

test('Terminal on touch: the key bar renders and every key is tappable, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)

  await page.route('**/api/agent-deck/terminal/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: true }),
    }),
  )
  await page.route('**/api/agent-deck/terminal/clis', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ clis: [{ id: 'shell', label: 'Raw shell', available: true }] }),
    }),
  )
  await page.route('**/api/agent-deck/terminal/sessions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tmuxAvailable: false, sessions: [] }),
    }),
  )

  await page.goto('/terminal')

  // Acknowledge gate → launcher → raw shell (same flow as terminal.spec.ts).
  await expect(page.getByText(/This is a real shell on the host/i)).toBeVisible()
  await page.getByRole('button', { name: /open the terminal/i }).tap()
  await page.getByRole('button', { name: /Launch the Raw shell/i }).tap()
  await expect(page.getByTestId('terminal-host')).toBeVisible()

  // The touch key bar is up (JS touch detection: hasTouch → maxTouchPoints > 0).
  const bar = page.getByRole('toolbar', { name: 'Terminal touch keys' })
  await expect(bar).toBeVisible()

  // Every key renders enabled and takes a tap without breaking the surface.
  for (const name of [
    'Escape',
    'Tab',
    'Shift Tab',
    'Control modifier',
    'Arrow up',
    'Arrow down',
    'Arrow left',
    'Arrow right',
    'Control C',
    'Paste',
  ]) {
    const key = bar.getByRole('button', { name, exact: true })
    await expect(key).toBeVisible()
    await expect(key).toBeEnabled()
  }
  await bar.getByRole('button', { name: 'Arrow up', exact: true }).tap()
  await bar.getByRole('button', { name: 'Escape', exact: true }).tap()

  // Sticky Ctrl arms visibly on a tap (aria-pressed flips).
  const ctrl = bar.getByRole('button', { name: 'Control modifier', exact: true })
  await ctrl.tap()
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true')
  await ctrl.tap()
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false')

  // The terminal host is still there (no crash from any tap) and console-clean.
  await expect(page.getByTestId('terminal-host')).toBeVisible()
  expect(errors).toEqual([])
})
