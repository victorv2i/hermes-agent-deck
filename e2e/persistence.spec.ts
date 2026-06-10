import { test, expect, MOCK_MODELS } from './fixtures'
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
 * HERMETIC live-run PERSISTENCE e2e — the flagship P1 guarantee, proven
 * end-to-end: the in-flight run SURVIVES navigation. This is the one behavior
 * that distinguishes a control room from a panel-on-a-tab — leave the Chat
 * surface mid-run, come back, and the SAME run is still streaming (its tool
 * calls + the pending approval still rendered inline in the transcript) and Stop
 * still terminates it.
 *
 * Why it holds (and what this spec locks in): the chat store is module-level and
 * lives ABOVE the route Outlet — so a route change re-renders only the content
 * pane, never the run. If anyone later moved the store inside the routed
 * surface, the run would reset on navigation and this spec goes red. (The run
 * signal renders INLINE in the chat stream — tool calls via ToolCard, the
 * pending approval via ApprovalCard — not in a separate drawer.)
 *
 * Rides the SAME in-process MOCK gateway as chat.spec.ts (scripts/serve-mock-
 * gateway.mjs, no live :8643), so it is part of the `pnpm verify` gate. The
 * scripted run streams text → a bash tool chip → an approval.request and then
 * PAUSES until resolved/stopped — that pause is a deterministic "Running" window
 * with no race. The Files REST is stubbed at the browser layer so navigating
 * there is console-clean without a live BFF/dashboard.
 */

const NOW = Math.floor(Date.now() / 1000)

// Minimal Files surface payloads so navigating to /files renders + stays
// console-clean with no live backend (FilesRoute fetches roots + a listing).
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

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/** Stub the Files REST so navigating to /files never hits a live BFF/dashboard. */
async function stubFiles(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/health')) return json(route, HEALTH)
    if (path.endsWith('/models')) return json(route, MOCK_MODELS)
    if (path.endsWith('/files/roots')) return json(route, FILE_ROOTS)
    if (path.endsWith('/files')) return json(route, FILE_LISTING)
    // The rail's organization store (drives render-time Object.values) must be a
    // well-formed empty store, not the catch-all {} below.
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    // Any other stray probe → harmless empty 200 (never 404-noise the console).
    return json(route, {})
  })
}

function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await composer.click()
  await composer.fill(text)
  await page.getByTestId('composer-send').click()
}

test('a local fork survives navigating off Chat and back; the run signal stays the source of truth', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubFiles(page)

  await page.goto('/chat')
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // Run to completion so we have settled messages, then fork from the first turn.
  await sendMessage(page, 'Say hi and clean the build')
  await expect(
    page.getByText('Hello, from the mock agent.').and(page.locator(':visible')).first(),
  ).toBeVisible()
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await approval.getByRole('button', { name: /allow once/i }).click()
  await expect(
    page.getByText('Hello, from the mock agent. All done. Anything else?', { exact: true }),
  ).toBeVisible()

  await page.getByText('Say hi and clean the build').hover()
  await page.getByRole('button', { name: 'Fork from here' }).first().click()
  const banner = page.getByTestId('fork-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(/forked locally/i)
  // The fork projected the ancestor path — the original reply is out of view.
  await expect(
    page.getByText('Hello, from the mock agent. All done. Anything else?', { exact: true }),
  ).toHaveCount(0)

  // Navigate OFF Chat (real SPA route change via ⌘K) and BACK. The branch UI
  // state is held in the module-level store ABOVE the route, so it survives.
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('combobox', { name: /command menu/i })
  await expect(palette).toBeVisible()
  await palette.fill('files')
  await page.getByRole('option', { name: /Files/ }).click()
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()

  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await palette.fill('chat')
  await page.getByRole('option', { name: /^Chat$/ }).click()

  // The fork branch state survived the route change: the banner is still shown,
  // the ancestor path is still projected (original reply still out of view), and
  // the run signal (composer back to Send — no run in flight) is unchanged.
  await expect(page.getByTestId('fork-banner')).toBeVisible()
  await expect(
    page.getByText('Hello, from the mock agent. All done. Anything else?', { exact: true }),
  ).toHaveCount(0)
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // The original is still reachable.
  await page.getByTestId('fork-return').click()
  await expect(
    page.getByText('Hello, from the mock agent. All done. Anything else?', { exact: true }),
  ).toBeVisible()

  expect(errors).toEqual([])
})

test('the in-flight run — its inline tool calls + pending approval — survives navigating off Chat and back, and Stop still terminates it', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubFiles(page)

  await page.goto('/chat')
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // Start a run from Chat. The scripted mock streams text + a bash tool chip,
  // then PAUSES at an approval.request — a deterministic "Running" window.
  await sendMessage(page, 'Say hi and clean the build')
  // Confirm an assistant reply rendered. The new sr-only chat-live-region also
  // carries this text (for screen readers), so intersect with :visible to target
  // the actual on-screen message bubble — robust whether it renders via the real
  // markdown chunk or the lazy fallback.
  await expect(
    page.getByText('Hello, from the mock agent.').and(page.locator(':visible')).first(),
  ).toBeVisible()

  // The run signal renders INLINE in the transcript: the bash tool call (a
  // ToolCard chip) and, at the pause, the pending approval (an ApprovalCard).
  // The composer's Stop button is the run's "in flight" anchor.
  await expect(page.getByTestId('toolcard-trigger').first()).toBeVisible()
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await expect(approval).toContainText('rm -rf ./build')
  await expect(page.getByTestId('composer-stop')).toBeVisible()

  // NAVIGATE off Chat via a genuine in-app SPA route change — NOT a reload (a
  // reload would remount the app and trivially lose the run; that is the WRONG
  // test). Use the real power-user path: the ⌘K command palette → "go to Files".
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('combobox', { name: /command menu/i })
  await expect(palette).toBeVisible()
  await palette.fill('files')
  await page.getByRole('option', { name: /Files/ }).click()
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()

  // NAVIGATE BACK to Chat (same in-app route change). The module-level store
  // outlives the route, so the SAME run is still in flight here.
  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await palette.fill('chat')
  await page.getByRole('option', { name: /^Chat$/ }).click()

  // 1) The run DID NOT reset on navigation: the same inline bash tool call + the
  //    same pending approval are still rendered, and the run is still in flight
  //    (composer still shows Stop). (Store outlives the route.)
  await expect(page.getByTestId('toolcard-trigger').first()).toBeVisible()
  await expect(approval).toBeVisible()
  await expect(approval).toContainText('rm -rf ./build')
  await expect(page.getByTestId('composer-stop')).toBeVisible()

  // 2) Stop from Chat still terminates the real run — the deterministic-Stop
  //    spine drives the actual run, not a faked control.
  await page.getByTestId('composer-stop').click()

  // The run leaves Running: the composer flips back to Send and the pending
  // approval clears.
  await expect(page.getByTestId('composer-send')).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await expect(approval).toHaveCount(0)

  expect(errors).toEqual([])
})
