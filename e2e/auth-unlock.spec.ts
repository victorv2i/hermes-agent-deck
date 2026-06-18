import { authTest as test, expect } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC auth-unlock E2E — the full remote-access path. Exercises the AuthGate
 * unlock screen, wrong-token rejection, correct-token acceptance, and the ERR-01
 * 401-intercept "session expired" unified screen. Uses `authTest` from fixtures
 * (onboarded=true, no stored auth token) so the wizard never fires.
 *
 * The health probe stubs `authRequired=true` to activate the AuthGate. No live
 * BFF is involved.
 *
 * Console-clean invariant: every test asserts expect(errors).toEqual([]).
 */

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

const HEALTH_AUTH_REQUIRED = {
  status: 'ok',
  hermes: {
    reachable: true,
    endpoint: 'http://127.0.0.1:8643',
    platform: 'hermes-agent',
  },
  bind: { remote: true, terminalEnabled: false, authRequired: true },
  version: '0.1.0',
}

const HEALTH_NO_AUTH = {
  status: 'ok',
  hermes: {
    reachable: true,
    endpoint: 'http://127.0.0.1:8643',
    platform: 'hermes-agent',
  },
  bind: { remote: false, terminalEnabled: true, authRequired: false },
  version: '0.1.0',
}

const CORRECT_TOKEN = 'hunter2-correct-token'

/**
 * The auth/check probe returns 401 when the token is wrong — the browser logs a
 * "Failed to load resource" 401 message for those requests. This is EXPECTED
 * behavior (it is what the test is verifying). We filter it out so the
 * console-clean invariant only catches genuine code errors.
 */
const BENIGN_AUTH = /Failed to load resource.*401|401.*Unauthorized/i

function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    if (BENIGN_AUTH.test(m.text())) return
    errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Stub BFF routes for the auth flow. The /auth/check probe returns 200 only for
 * the CORRECT_TOKEN, 401 for anything else.
 */
async function stubAuthBff(page: Page, options: { authRequired: boolean }) {
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()

    if (path.endsWith('/health')) {
      return json(route, options.authRequired ? HEALTH_AUTH_REQUIRED : HEALTH_NO_AUTH)
    }

    // The auth/check probe: accept only the correct token.
    if (path.endsWith('/auth/check') && method === 'GET') {
      const authHeader = route.request().headers()['authorization'] ?? ''
      const token = authHeader.replace(/^Bearer\s+/i, '').trim()
      if (token === CORRECT_TOKEN) return json(route, { ok: true })
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"unauthorized"}',
      })
    }

    // Other BFF calls: return harmless stubs so the shell loads cleanly.
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, { sessions: [] })
    if (path.endsWith('/models')) return json(route, { provider: {}, models: [] })
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
            skillCount: 0,
            gatewayRunning: false,
          },
        ],
      })
    return json(route, {})
  })
}

// ---------------------------------------------------------------------------
// Test 1 — authRequired=true renders the AuthGate lock screen
// ---------------------------------------------------------------------------
test('health authRequired=true renders the unlock screen, not the app shell', async ({ page }) => {
  const errors = trackConsole(page)
  await stubAuthBff(page, { authRequired: true })

  await page.goto('/chat')

  // The AuthGate renders its lock screen.
  await expect(page.getByTestId('auth-gate')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Agentdeck is locked/i })).toBeVisible()
  // The unlock form is present.
  await expect(page.getByRole('button', { name: /Unlock Agentdeck/i })).toBeVisible()
  // The app shell (connection-dot) must NOT be rendered behind the gate.
  await expect(page.getByTestId('connection-dot')).not.toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 2 — wrong token shows the honest rejection message
// ---------------------------------------------------------------------------
test('entering a wrong token shows the rejection message, stays on the unlock screen', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubAuthBff(page, { authRequired: true })

  await page.goto('/chat')
  await expect(page.getByTestId('auth-gate')).toBeVisible()

  const tokenInput = page.getByLabel(/Access token/i)
  await tokenInput.fill('wrong-token-abc')
  await page.getByRole('button', { name: /Unlock Agentdeck/i }).click()

  // The rejection message appears.
  await expect(page.getByText(/Token rejected/i)).toBeVisible()
  // We're still on the lock screen.
  await expect(page.getByTestId('auth-gate')).toBeVisible()
  // The app shell is still NOT mounted.
  await expect(page.getByTestId('connection-dot')).not.toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 3 — correct token unlocks to the app shell
// ---------------------------------------------------------------------------
test('correct token unlocks the app and the shell renders', async ({ page }) => {
  const errors = trackConsole(page)
  await stubAuthBff(page, { authRequired: true })

  await page.goto('/chat')
  await expect(page.getByTestId('auth-gate')).toBeVisible()

  const tokenInput = page.getByLabel(/Access token/i)
  await tokenInput.fill(CORRECT_TOKEN)
  await page.getByRole('button', { name: /Unlock Agentdeck/i }).click()

  // The auth gate disappears and the app shell renders.
  await expect(page.getByTestId('auth-gate')).not.toBeVisible()
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 4 — 401 intercept (ERR-01): session expired screen, not blank surfaces
// ---------------------------------------------------------------------------
test('ERR-01: a 401 response after unlock shows the session-expired screen, not a blank surface', async ({
  page,
}) => {
  const errors = trackConsole(page)

  const PROFILES_STUB = {
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
        skillCount: 0,
        gatewayRunning: false,
      },
    ],
  }

  // Start with auth NOT required so the shell loads initially.
  // After the shell mounts, make the /profiles call return 401 to trigger ERR-01.
  let profilesCallCount = 0
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname

    if (path.endsWith('/health')) return json(route, HEALTH_NO_AUTH)
    if (path.endsWith('/auth/check')) return json(route, { ok: true })
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, { sessions: [] })
    if (path.endsWith('/models')) return json(route, { provider: {}, models: [] })

    // The /profiles endpoint: first call is the initial load (return data),
    // second call (after navigation to /profiles) triggers the 401 intercept.
    if (path.endsWith('/profiles') && !path.includes('/profiles/')) {
      profilesCallCount++
      if (profilesCallCount >= 2) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Token expired' }),
        })
      }
      return json(route, PROFILES_STUB)
    }

    return json(route, {})
  })

  await page.goto('/chat')
  // Wait for the shell to mount.
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // Navigate to the profiles surface — the second /profiles call returns 401.
  await page.goto('/profiles')

  // The session-expired screen should appear — not a blank surface or error card.
  await expect(page.getByTestId('session-expired')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Session expired/i })).toBeVisible()
  // The re-entry form is present.
  await expect(page.getByRole('button', { name: /Re-enter access token/i })).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 5 — authRequired=false skips the gate entirely
// ---------------------------------------------------------------------------
test('authRequired=false: the AuthGate passes through to the app shell with no lock screen', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubAuthBff(page, { authRequired: false })

  await page.goto('/chat')

  // The lock screen must never appear when auth is not required.
  await expect(page.getByTestId('auth-gate')).not.toBeVisible()
  // The app shell renders directly.
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  expect(errors).toEqual([])
})
