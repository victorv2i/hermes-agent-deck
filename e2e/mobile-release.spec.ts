import { test, expect, MOCK_MODELS } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC mobile RELEASE-READINESS E2E — the narrowest supported viewport
 * (375px, iPhone-SE-class). Where `mobile.spec.ts` proves the slide-over
 * mechanics at 390px, this guards the release bar that a phone screen must not
 * be visually broken or carry desktop-only chrome:
 *  - The sticky header does NOT horizontally overflow at 375px (body scrollWidth
 *    never exceeds the viewport — the same documentElement check below).
 *  - The terminal-dock toggle (a desktop/power affordance) is NOT visible on
 *    mobile — it is `sm`-only, so it stays in the DOM but CSS-hidden.
 *  - The rail opens as a one-tap slide-over and the New chat button is reachable
 *    from it.
 *  - A message can be sent and its bubble renders.
 *  - No horizontal scroll on the main surfaces (chat + a secondary surface).
 *
 * All BFF REST is stubbed (helpers copied verbatim from `mobile.spec.ts`). The
 * viewport is forced to 375×812 before each test.
 *
 * Console-clean invariant: every test asserts expect(errors).toEqual([]).
 */

const MOBILE_VIEWPORT = { width: 375, height: 812 }

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

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

const SESSIONS = {
  total: 2,
  sessions: [
    {
      id: 'sess-m1',
      source: 'web',
      model: 'anthropic/claude-sonnet-4',
      title: 'Mobile session one',
      preview: 'session 1',
      started_at: 2,
      last_active: 2,
      message_count: 3,
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      cost_usd: null,
      is_active: false,
    },
    {
      id: 'sess-m2',
      source: 'web',
      model: 'anthropic/claude-sonnet-4',
      title: 'Mobile session two',
      preview: 'session 2',
      started_at: 1,
      last_active: 1,
      message_count: 1,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: null,
      is_active: false,
    },
  ],
}

// Unified /runtimes history with worst-case content for the mobile overflow
// check: a long absolute cwd + a long model id + six-figure token counts, the
// row shape most likely to push past a 375px screen if a column isn't bounded.
const RUNTIMES = {
  sessions: [
    {
      runtime: 'hermes',
      id: 'h1',
      title: 'A reasonably long session title that should truncate, not overflow',
      model: 'anthropic/claude-sonnet-4-6',
      startedAt: 2,
      lastActive: 2,
      messageCount: 42,
      inputTokens: 120000,
      outputTokens: 30000,
      cwd: null,
    },
    {
      runtime: 'claude',
      id: 'c1',
      title: 'Refactor the runtimes surface',
      model: 'claude-sonnet-4-6',
      startedAt: 1,
      lastActive: 1,
      messageCount: 88,
      inputTokens: 500000,
      outputTokens: 90000,
      cwd: '/home/wonny/Projects/agent-deck/apps/web/src/features/runtimes',
    },
  ],
  sources: [
    {
      runtime: 'hermes',
      capabilities: { chat: true, approvals: true, usage: true, sessions: true },
      sessionCount: 1,
      available: true,
    },
    {
      runtime: 'claude',
      capabilities: { chat: false, approvals: false, usage: true, sessions: true },
      sessionCount: 1,
      available: true,
    },
    {
      runtime: 'codex',
      capabilities: { chat: false, approvals: false, usage: true, sessions: true },
      sessionCount: 0,
      available: true,
    },
  ],
}

function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

async function stubBff(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/health')) return json(route, HEALTH)
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    // MUST precede the generic `/sessions` branch: `/runtimes/sessions` also ends
    // with `/sessions` but needs the unified-history shape, not the Hermes one.
    if (path.endsWith('/runtimes/sessions')) return json(route, RUNTIMES)
    if (path.endsWith('/sessions')) return json(route, SESSIONS)
    if (path.endsWith('/models')) return json(route, MOCK_MODELS)
    if (path.endsWith('/profiles'))
      return json(route, {
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
      })
    if (path.includes('/sessions/sess-m1/messages'))
      return json(route, {
        session_id: 'sess-m1',
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'hi mobile',
            timestamp: 2,
            reasoning: null,
            tool_name: null,
            tool_calls: [],
          },
        ],
      })
    if (path.endsWith('/sessions/sess-m1'))
      return json(route, {
        ...SESSIONS.sessions[0]!,
        ended_at: 2,
        end_reason: 'completed',
        tool_call_count: 0,
      })
    return json(route, {})
  })
}

/**
 * The horizontal-overflow invariant: the document must never be wider than the
 * viewport, so a phone screen never gains a sideways scrollbar. `scrollWidth`
 * is the rendered content width; `clientWidth` is the viewport width. A 1px
 * slack absorbs sub-pixel rounding without hiding a real overflow.
 */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
}

// ---------------------------------------------------------------------------
// Test 1 — the sticky header does not horizontally overflow at 375px
// ---------------------------------------------------------------------------
test('mobile-release: header does not horizontally overflow at 375px', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  const header = page.locator('header[role="banner"]').first()
  await expect(header).toBeVisible()

  // The body/document must not be wider than the viewport: a header that
  // overflowed at 375px would push scrollWidth past clientWidth.
  await expectNoHorizontalScroll(page)

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 2 — the terminal-dock toggle is NOT visible on mobile (sm-only)
// ---------------------------------------------------------------------------
test('mobile-release: terminal-dock toggle is hidden on mobile', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // The toggle is a desktop/power affordance shed below `sm` — it stays in the
  // DOM (terminal is enabled in HEALTH) but is CSS-hidden, so NOT visible.
  await expect(page.getByTestId('terminal-dock-toggle')).not.toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 3 — the rail opens as a slide-over and New chat is reachable from it
// ---------------------------------------------------------------------------
test('mobile-release: rail slide-over exposes a reachable New chat button', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  // Rail starts hidden on mobile.
  await expect(rail).toHaveAttribute('aria-hidden', 'true')

  // One tap opens the slide-over.
  await page.getByRole('button', { name: /open navigation/i }).click()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')

  // New chat is reachable from inside the open slide-over.
  await expect(rail.getByRole('button', { name: /New chat/i })).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 4 — sending a message works and the reply renders on mobile
// ---------------------------------------------------------------------------
test('mobile-release: sending a message renders the mock reply', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  const composer = page.getByRole('textbox', { name: /Message your agent/i })
  await expect(composer).toBeVisible()

  await composer.fill('Hello from mobile release')
  await page.getByTestId('composer-send').click()

  // The user bubble echoes, then the in-process mock streams its fixed reply.
  // Scope to the transcript so this proves both turns rendered IN the message
  // list (not merely that "some text appeared somewhere on the page"); the two
  // distinct strings mean the reply text can only be the streamed assistant delta.
  const transcript = page.getByTestId('message-list')
  await expect(transcript.getByText('Hello from mobile release')).toBeVisible()
  await expect(transcript.getByText('Taking a look at the build folder first.')).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 5 — no horizontal scroll on the main surfaces
// ---------------------------------------------------------------------------
test('mobile-release: no horizontal scroll on the main surfaces', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  // Primary surface: the chat cockpit.
  await expect(page.getByTestId('connection-dot')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // Secondary surface, reached the way a phone user does — via the slide-over.
  // (Agents folded into Home, so navigate to Files — a stable top-level surface.)
  await page.getByRole('button', { name: /open navigation/i }).click()
  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')
  await rail.getByRole('link', { name: /^Files$/i }).click()
  await expect(page).toHaveURL(/\/files$/)
  await expectNoHorizontalScroll(page)

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 6 — the /runtimes history (dense rows) fits a phone screen
// ---------------------------------------------------------------------------
test('mobile-release: /runtimes has no horizontal scroll with dense content', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  // Reach /runtimes the way a phone user does: via the slide-over rail.
  await page.getByRole('button', { name: /open navigation/i }).click()
  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')
  await rail.getByRole('link', { name: /^Runtimes$/i }).click()
  await expect(page).toHaveURL(/\/runtimes$/)

  // The dense session rows (long cwd, six-figure token counts, read-only badges,
  // the usage rollup, the source filter) must render AND fit the 375px screen.
  await expect(page.getByText('Refactor the runtimes surface')).toBeVisible()
  await expectNoHorizontalScroll(page)

  expect(errors).toEqual([])
})
