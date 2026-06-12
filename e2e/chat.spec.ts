import { test, expect, MOCK_MODELS } from './fixtures'
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

const NOW = Math.floor(Date.now() / 1000)

/**
 * HERMETIC chat e2e — the BFF runs against an IN-PROCESS MOCK gateway
 * (scripts/serve-mock-gateway.mjs, AGENT_DECK_BFF_TARGET → :7899). No live
 * gateway is involved, so this is part of the `pnpm verify` gate.
 *
 * The mock streams a scripted run:
 *   "Taking a look " + "at the build " + "folder first."   (streamed deltas)
 *   → bash tool chip (started/completed)
 *   → approval.request (pauses until resolved or stopped)
 *   → on Allow: a second bash tool step, then " Build folder cleared." +
 *     " The repo is tidy and ready to ship." → run.completed
 *   → on Stop:  run.cancelled
 */

/** Collect console errors so each test can assert it stayed console-clean. */
function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Stub the dashboard-backed REST the app fires on load (the model picker's
 * `/models`, the rail's `/sessions`, status/config/usage) with minimal valid
 * bodies, so the chat run is HERMETIC: the connection dot and the run itself ride
 * the real mock `/socket.io` flow (NOT matched by this `/api/agent-deck/**` glob),
 * while the load-time REST never proxies to the hermes dashboard (:9123). That
 * makes the run deterministic and console-clean whether or not the dashboard is
 * up — the spec only asserts the streamed run, never the dashboard surfaces.
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
    if (path.endsWith('/models')) return fulfill(MOCK_MODELS)
    // The rail's organization store (drives render-time Object.values) must be a
    // well-formed empty store, not the catch-all {} below.
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return fulfill({ projects: [], assignments: {} })
    if (path.endsWith('/organization')) return fulfill({ projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return fulfill({ results: [] })
    if (path.endsWith('/sessions')) return fulfill({ sessions: [] })
    // Any other dashboard-backed read: a harmless empty 200 so a load-time probe
    // never 502-noises the console when the dashboard is down.
    return fulfill({})
  })
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await composer.click()
  await composer.fill(text)
  await page.getByTestId('composer-send').click()
}

test('streams a reply, renders an expandable tool chip, resolves an approval, and completes', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')

  // Connected to the mock BFF.
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  await sendMessage(page, 'Say hi and clean the build')

  // The user's turn is echoed.
  await expect(page.getByText('Say hi and clean the build')).toBeVisible()

  // Streamed assistant text appears (token-by-token from the mock).
  await expect(page.getByText('Taking a look at the build folder first.')).toBeVisible()

  // A quiet, collapsed tool chip — expandable, never auto-expanded. In calm mode
  // a known tool reads as a plain-language action ("Run command"), not the raw
  // tool name, so a newcomer parses what happened at a glance.
  const toolChip = page.getByTestId('toolcard-trigger')
  await expect(toolChip).toBeVisible()
  await expect(toolChip).toContainText(/Run command/i)
  // Collapsed by default → expand reveals the detail, including the REAL tool
  // name (honesty for power users — the plain label never hides what ran).
  const toolContent = page.getByTestId('toolcard-content')
  await expect(toolContent).toBeHidden()
  await toolChip.click()
  await expect(toolContent).toBeVisible()
  await expect(toolContent).toContainText('bash')
  await expect(toolContent).toContainText('ls -la')

  // An inline approval prompt appears (not a modal) and is unmissable yet calm.
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await expect(approval).toContainText('rm -rf ./build')
  await expect(approval).toContainText(/delete the build directory/i)

  // Round-trip: Allow once → the card clears and the run resumes to completion.
  await approval.getByRole('button', { name: /allow once/i }).click()
  await expect(approval).toBeHidden()

  // Final assembled message after the approval resolves. Exact match targets the
  // visible prose, not the polite a11y live region (which prefixes "Assistant
  // replied: …" and would otherwise also substring-match this text).
  await expect(
    page.getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    ),
  ).toBeVisible()

  // Run finished → composer is back to Send (not Stop).
  await expect(page.getByTestId('composer-send')).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('a SETTLED chat survives a browser refresh: the URL carries the session id and the transcript rehydrates', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)

  // The durable transcript the BFF serves for this conversation on reload. The
  // distinct "Restored from history." marker proves the post-reload content came
  // from the rehydration fetch, NOT leftover DOM from the pre-reload live run.
  // Registered AFTER stubDashboardRest so this specific route wins (Playwright
  // matches most-recently-registered first).
  await page.route('**/api/agent-deck/sessions/sess-live/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session_id: 'sess-live',
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'Say hi and clean the build',
            timestamp: NOW,
            reasoning: null,
            tool_name: null,
            tool_calls: [],
          },
          {
            id: '2',
            role: 'assistant',
            content: 'Restored from history.',
            timestamp: NOW,
            reasoning: null,
            tool_name: null,
            tool_calls: [],
          },
        ],
      }),
    }),
  )

  await page.goto('/chat')
  await expect(page.getByTestId('connection-dot')).toBeVisible()
  await sendMessage(page, 'Say hi and clean the build')

  // The fresh chat learns its durable session id (surfaced on run.started) and
  // reflects it into the URL — the refresh-safe restore key.
  await expect(page).toHaveURL(/\/chat\/sess-live$/)

  // Resolve the approval so the run SETTLES (terminal → sessionStorage cleared),
  // making the reload below a HISTORY rehydration, not an in-flight resume.
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await approval.getByRole('button', { name: /allow once/i }).click()
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // THE FIX: a hard refresh RESTORES the conversation from the session id in the
  // URL instead of dropping into a blank chat (the "lost in the chat rail" bug).
  await page.reload()
  await expect(page.getByText('Restored from history.')).toBeVisible()
  await expect(page.getByText('Say hi and clean the build')).toBeVisible()
  // Stayed on the addressable conversation URL across the refresh.
  await expect(page).toHaveURL(/\/chat\/sess-live$/)

  expect(errors).toEqual([])
})

test('fork from a settled message creates a local branch; the original stays reachable; console clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // Run a full chat to completion so we have SETTLED messages to fork from.
  await sendMessage(page, 'Say hi and clean the build')
  await expect(page.getByText('Taking a look at the build folder first.')).toBeVisible()
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await approval.getByRole('button', { name: /allow once/i }).click()
  await expect(
    page.getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // Fork from the FIRST settled message (the user turn). Hover to reveal the
  // action row, then click "Fork from here".
  const firstUserTurn = page.getByText('Say hi and clean the build')
  await firstUserTurn.hover()
  const forkBtn = page.getByRole('button', { name: 'Fork from here' }).first()
  await forkBtn.click()

  // The honest local-fork banner appears (local means local — no DAG claim).
  const banner = page.getByTestId('fork-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(/forked locally/i)
  await expect(banner).toContainText(/your original chat is still saved/i)

  // The ancestor path is projected: the original reply is no longer in view.
  await expect(
    page.getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    ),
  ).toHaveCount(0)

  // Send ON the fork — a fresh run streams its reply onto the fork branch.
  await sendMessage(page, 'Take a different path')
  await expect(page.getByText('Take a different path')).toBeVisible()
  await expect(page.getByText('Taking a look at the build folder first.').first()).toBeVisible()
  // Stop this second run so the test ends deterministically (it would otherwise
  // pause at an approval).
  const stop = page.getByTestId('composer-stop')
  if (await stop.isVisible()) await stop.click()
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // The ORIGINAL continuation is still reachable: return to it.
  await page.getByTestId('fork-return').click()
  await expect(
    page.getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    ),
  ).toBeVisible()
  // The divergent prompt is NOT on the original path.
  await expect(page.getByText('Take a different path')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('Stop aborts an in-flight run', async ({ page }) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')

  await sendMessage(page, 'Start a long task')

  // While streaming, Send becomes Stop.
  const stop = page.getByTestId('composer-stop')
  await expect(stop).toBeVisible()

  // Wait for streaming to actually start before aborting.
  await expect(page.getByText(/Taking a look/)).toBeVisible()

  await stop.click()

  // The run halts: Stop reverts to Send (idle) and the approval prompt that the
  // scripted run would have reached never appears.
  await expect(page.getByTestId('composer-send')).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await expect(page.getByTestId('approval-card')).toHaveCount(0)

  expect(errors).toEqual([])
})
