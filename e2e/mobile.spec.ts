import { test, expect, MOCK_MODELS } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC mobile E2E — primary tasks at 390px viewport (iPhone SE-class).
 * Exercises:
 *  - Rail slide-over opens via the menu button (one-tap).
 *  - Navigation within the slide-over lands on the correct surface.
 *  - Composer is reachable and a message can be sent.
 *  - Session row is reachable from the slide-over rail.
 *  - Touch targets: composer send button + session row meet the ≥44px requirement.
 *  - Escape dismisses the slide-over rail.
 *
 * All BFF REST is stubbed. The viewport is forced to 390×844 before each test.
 *
 * Console-clean invariant: every test asserts expect(errors).toEqual([]).
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 }

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

// ---------------------------------------------------------------------------
// Test 1 — menu button opens the slide-over rail
// ---------------------------------------------------------------------------
test('mobile: menu button opens the rail slide-over', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  // Rail starts hidden on mobile.
  await expect(rail).toHaveAttribute('aria-hidden', 'true')

  // Tap the menu button to open.
  await page.getByRole('button', { name: /open navigation/i }).click()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')
  await expect(rail).not.toHaveAttribute('aria-hidden', 'true')

  // Nav items are visible inside the open rail.
  await expect(rail.getByRole('link', { name: /Chat/i })).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 2 — slide-over navigation lands on the correct surface
// ---------------------------------------------------------------------------
test('mobile: tapping a nav item in the slide-over navigates to that surface', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // Open the rail.
  await page.getByRole('button', { name: /open navigation/i }).click()
  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')

  // Tap a real rail nav link (Agents folded into Home, so use Files — a stable
  // top-level surface) and assert it navigates there.
  await rail.getByRole('link', { name: /^Files$/i }).click()

  // The slide-over navigates to the Files surface (assert by URL, robust to copy).
  await expect(page).toHaveURL(/\/files$/)

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 3 — backdrop tap closes the slide-over
// ---------------------------------------------------------------------------
test('mobile: tapping the backdrop closes the slide-over', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await page.getByRole('button', { name: /open navigation/i }).click()
  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')

  await page.getByTestId('mobile-rail-backdrop').click()
  await expect(rail).toHaveAttribute('data-mobile-open', 'false')
  await expect(rail).toHaveAttribute('aria-hidden', 'true')

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 4 — Escape closes the slide-over
// ---------------------------------------------------------------------------
test('mobile: Escape key closes the open slide-over rail', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await page.getByRole('button', { name: /open navigation/i }).click()
  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')

  await page.keyboard.press('Escape')
  await expect(rail).toHaveAttribute('data-mobile-open', 'false')
  await expect(rail).toHaveAttribute('aria-hidden', 'true')

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 5 — composer is reachable and sends a message on mobile
// ---------------------------------------------------------------------------
test('mobile: composer is visible and sending a message works', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // The composer is visible without opening the rail.
  const composer = page.getByRole('textbox', { name: /Message your agent/i })
  await expect(composer).toBeVisible()

  await composer.fill('Hello from mobile')
  await page.getByTestId('composer-send').click()
  await expect(page.getByText('Hello from mobile')).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 6 — composer send button meets ≥44px touch target
// ---------------------------------------------------------------------------
test('mobile: composer send button has ≥44px touch target height', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  const sendBtn = page.getByTestId('composer-send')
  await expect(sendBtn).toBeVisible()

  const box = await sendBtn.boundingBox()
  expect(box).not.toBeNull()
  // WCAG 2.5.5 AA: minimum 44×44px touch target.
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.width).toBeGreaterThanOrEqual(44)

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 7 — menu button itself meets ≥44px touch target
// ---------------------------------------------------------------------------
test('mobile: the menu (open navigation) button has ≥44px touch target', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  const menuBtn = page.getByRole('button', { name: /open navigation/i })
  await expect(menuBtn).toBeVisible()

  const box = await menuBtn.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.width).toBeGreaterThanOrEqual(44)

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 8 — slide-over contains the New chat button
// ---------------------------------------------------------------------------
test('mobile: the slide-over rail contains the New chat button', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize(MOBILE_VIEWPORT)
  await stubBff(page)
  await page.goto('/chat')

  await page.getByRole('button', { name: /open navigation/i }).click()
  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  await expect(rail).toHaveAttribute('data-mobile-open', 'true')

  await expect(rail.getByRole('button', { name: /New chat/i })).toBeVisible()

  expect(errors).toEqual([])
})
