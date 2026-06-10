import { test, expect, MOCK_MODELS } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC release-readiness CRITICAL-PATH journey — ONE console-clean flow that
 * walks the operator's spine end-to-end with the onboarded fixture: land on the
 * app shell, chat (send → streamed assistant reply), switch the color THEME from
 * the ⌘K command palette (asserting the real `data-palette` re-theme on <html>),
 * open the dedicated Sessions rail (a session row is present), then exercise the
 * single side-panel slot's MUTUAL EXCLUSION — open the Preview panel, then open
 * the Work panel (artifact canvas) from a code block, and confirm only ONE
 * occupies the shared column at a time.
 *
 * Hermetic like the other gate specs: the chat run rides the IN-PROCESS MOCK
 * gateway (`/chat-run` socket on the mock BFF — NOT matched by the `/api/...`
 * glob), while every load-time REST read is stubbed at the browser layer via
 * `page.route()` so the journey is deterministic whether or not a live
 * gateway/dashboard is up. The mock's `demo:code` trigger streams a NAMED fenced
 * code artifact, which renders a CodeBlock whose "Open in panel" button opens the
 * Work panel — the real user action this journey drives.
 *
 * Console-clean invariant: a SINGLE collector spans the WHOLE journey and the
 * final assertion is `expect(problems).toEqual([])`. Modeled on the console-error
 * capture in route-smoke.spec.ts (errors + warnings + pageerror + same-origin
 * 4xx/5xx) and surfaces.spec.ts. The one benign exception is the transport-layer
 * WebSocket notice a live socket surface emits with no backend (route-smoke's
 * BENIGN_CONSOLE) — the same allowance, nothing of ours.
 */

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

/** A single web-originated session so the dedicated Sessions rail shows a row. */
const SESSIONS = {
  total: 1,
  sessions: [
    {
      id: 'sess-journey',
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

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Stub the dashboard-backed REST the app fires on load (the model picker's
 * `/models`, the rail's `/sessions` + organization store, terminal-status) with
 * minimal valid bodies, so the journey is HERMETIC: the connection dot and the
 * chat run itself ride the real mock `/socket.io` flow (NOT matched by this
 * `/api/agent-deck/**` glob), while every load-time REST read resolves to a
 * healthy shape and never proxies to a live dashboard. MOCK_MODELS carries a
 * usable model so the composer is enabled (a working chat needs a reachable model).
 */
async function stubBff(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/health')) return json(route, HEALTH)
    if (path.endsWith('/models')) return json(route, MOCK_MODELS)
    // The rail's organization store drives render-time Object.values(assignments),
    // so it MUST be a well-formed empty store (the catch-all {} would crash it).
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, SESSIONS)
    // The terminal dock probes availability; an "available" shape keeps the chrome
    // honest (the journey never opens the dock, so its content is never mounted).
    if (path.endsWith('/terminal/status'))
      return json(route, { available: true, cwd_available: true })
    // Anything else: a harmless empty 200 so a load-time probe never 404/502-noises.
    return json(route, {})
  })
}

/**
 * Benign, ENVIRONMENTAL console noise expected with NO live backend — a live
 * socket surface tries to open a WebSocket that never connects in the hermetic
 * test, which the browser reports as a transport warning. The UI degrades
 * honestly; the notice is the browser's, not ours. (Same allowance as
 * route-smoke.spec.ts — we never swallow our own code's warnings/errors.)
 */
const BENIGN_CONSOLE = /WebSocket (connection|is closed before the connection)/i

/**
 * Collect console errors + warnings + page errors + same-origin 4xx/5xx across
 * the WHOLE journey so the final assertion can lock in console-cleanliness.
 */
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
  page.on('response', (res) => {
    const status = res.status()
    if (status < 400) return
    const url = new URL(res.url())
    if (url.host !== originHost) return
    problems.push(`http ${status}: ${url.pathname}`)
  })
  return problems
}

test('release-readiness: shell → chat → theme → sessions → side-panel exclusion, all console-clean', async ({
  page,
  baseURL,
}) => {
  const originHost = new URL(baseURL ?? 'http://127.0.0.1:5199').host
  const problems = trackCleanliness(page, originHost)
  await stubBff(page)

  // ── 1. Land on the app shell ──────────────────────────────────────────────
  // The onboarded fixture lands a returning user in the cockpit (not the Home
  // wizard); go straight to Chat — the split-rail conversation surface.
  await page.goto('/chat')
  // The persistent chrome is up (connection dot) and connected to the mock BFF.
  await expect(page.getByTestId('connection-dot')).toBeVisible()
  // The Chat surface mounted its composer landmark + the dedicated sessions pane.
  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await expect(composer).toBeVisible()
  await expect(page.getByTestId('sessions-pane')).toBeVisible()

  // ── 2. Chat: send a message → the streamed assistant reply appears ─────────
  await composer.click()
  await composer.fill('Say hi')
  await page.getByTestId('composer-send').click()
  // The user's turn is echoed and the mock streams its fixed reply.
  await expect(page.getByText('Say hi')).toBeVisible()
  await expect(page.getByText('Hello, from the mock agent.')).toBeVisible()
  // The scripted run pauses at an approval; Stop it so the journey continues from
  // a settled, idle composer (no in-flight run bleeding into later steps).
  const stop = page.getByTestId('composer-stop')
  if (await stop.isVisible()) await stop.click()
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // ── 3. Switch the THEME via the ⌘K command palette ─────────────────────────
  // The resting palette is the default Clay & Sky → <html> carries NO data-palette.
  await expect(page.locator('html')).not.toHaveAttribute('data-palette', /.*/)
  await page.keyboard.press('Control+K')
  const palette = page.getByRole('combobox', { name: /command menu/i })
  await expect(palette).toBeFocused()
  // Filter to the appearance group and pick the Warm Void · Nous family.
  await palette.fill('Warm Void')
  await page.getByRole('option', { name: /Set theme to Warm Void/i }).click()
  // The palette closed and the choice re-themed the app LIVE: a non-default family
  // stamps `data-palette="<id>"` on <html> (features/themes/palette.ts).
  await expect(palette).not.toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'warm-void')

  // ── 4. Open the Sessions rail → a session row is present ───────────────────
  // The dedicated pane lists the stubbed web session as a clickable row.
  const sessionsPane = page.getByTestId('sessions-pane')
  await expect(sessionsPane).toBeVisible()
  await expect(sessionsPane.getByRole('button', { name: /^Refactor the parser/ })).toBeVisible()

  // ── 5. Side-panel MUTUAL EXCLUSION: Preview, then Work ─────────────────────
  // The single right column hosts the Preview panel, the Work panel, OR the
  // Terminal dock — only one at a time. Open the Preview panel via its header
  // toggle (Globe / ⌘⇧V): with nothing else open, it takes the slot.
  await page.getByTestId('preview-toggle').click()
  const previewDrawer = page.getByTestId('preview-drawer')
  await expect(previewDrawer).toHaveAttribute('data-open', 'true')
  // The Preview panel content is the visible occupant; the (mounted) Work panel is
  // hidden behind it.
  await expect(page.getByTestId('preview-panel')).toBeVisible()
  await expect(page.getByTestId('work-panel')).toBeHidden()

  // Open the WORK panel from a real artifact: ask for the code demo, then click the
  // CodeBlock's "Open in panel" button. Opening the Work panel evicts the Preview
  // panel from the visible slot (the SidePanel precedence shows Work over Preview),
  // so the two never co-occupy the column.
  await composer.click()
  await composer.fill('demo:code')
  await page.getByTestId('composer-send').click()
  // The named fenced artifact streamed in — its code block carries the affordance.
  const openInPanel = page.getByRole('button', { name: 'Open in panel' })
  await expect(openInPanel).toBeVisible()
  await openInPanel.click()

  // The slot stays open, but the OCCUPANT swapped: Work is now visible, Preview is
  // hidden — the single-slot mutual exclusion, observed in the DOM.
  await expect(previewDrawer).toHaveAttribute('data-open', 'true')
  const workPanel = page.getByTestId('work-panel')
  await expect(workPanel).toBeVisible()
  await expect(workPanel.getByTestId('work-panel-artifact')).toBeVisible()
  await expect(page.getByTestId('preview-panel')).toBeHidden()

  // ── Whole-journey console-cleanliness ──────────────────────────────────────
  expect(problems, 'the release journey surfaced console/page/http problems').toEqual([])
})
