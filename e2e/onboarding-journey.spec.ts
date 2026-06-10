import { freshTest as test, expect } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC newcomer-journey E2E — the most important flow: a first-time user
 * with NO `agent-deck:onboarded` flag and NO prior setup. This exercises the
 * full "Wake your agent" wizard path (detect → connect → identity → first chat)
 * that the cockpit specs intentionally skip (they pre-seed the onboarded flag).
 *
 * Every backend call is stubbed via page.route. The wizard is driven by the
 * `/api/agent-deck/setup-status` probe; we serve a real-enough response at each
 * rung so the gate advances naturally. The first-chat rung uses the in-process
 * mock `/chat-run` socket (not stubbed) so it can assert a real send interaction.
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

/** An empty-but-valid usage payload so the Home StatusBand never crashes. */
const USAGE_EMPTY = {
  periodDays: 7,
  totals: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    estimatedCost: 0,
    actualCost: 0,
    sessions: 0,
  },
  daily: [],
  byModel: [],
}

/** A "nothing installed yet" setup-status — lands the wizard on detect rung. */
const STATUS_BLANK = {
  hermesInstalled: false,
  providerConnected: false,
  agentNamed: false,
}

/** Hermes installed but no provider yet — advances past detect. */
const STATUS_INSTALLED = {
  hermesInstalled: true,
  providerConnected: false,
  agentNamed: false,
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

function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Stub all BFF routes needed by the wizard and the subsequent chat surface.
 * The setup-status response is returned from a mutable holder so individual
 * tests can advance the probe by mutating `statusHolder.value`.
 */
function stubBffForWizard(page: Page, statusHolder: { value: object }) {
  return page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname

    if (path.endsWith('/health')) return json(route, HEALTH)
    if (path.endsWith('/setup-status')) return json(route, statusHolder.value)

    // Avatar write (identity rung POST/PUT) — accept without a real filesystem.
    if (path.endsWith('/avatar')) return json(route, { ok: true })
    // Provider OAuth start — needed by connect rung; return a session immediately
    // connected so the rung can advance.
    if (path.includes('/provider-oauth') && route.request().method() === 'POST') {
      return json(route, { provider: 'nous', status: 'connected', sessionId: null, url: null })
    }
    // Setup provider-key route.
    if (path.endsWith('/setup/provider-key')) {
      return json(route, { connected: true, provider: 'anthropic' })
    }
    // Organization store (rail).
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
    // Usage: return a well-shaped empty payload so StatusBand on Home never crashes.
    if (path.endsWith('/usage')) return json(route, USAGE_EMPTY)

    // Status/system/sessions/files/etc.
    if (path.endsWith('/status'))
      return json(route, {
        gatewayRunning: false,
        gatewayState: 'stopped',
        platforms: [],
        activeSessions: 0,
        version: '0.0.0',
        configUpdateAvailable: false,
      })
    if (path.endsWith('/system'))
      return json(route, {
        gateway: { status: 'stopped' },
        hermes: { status: 'up-to-date', currentVersion: '0.0.0' },
        agentDeck: { status: 'no-channel', currentVersion: '0.1.0' },
      })

    // Anything else: harmless empty 200.
    return json(route, {})
  })
}

// ---------------------------------------------------------------------------
// Test 1 — blank slate renders the wizard (detect rung)
// ---------------------------------------------------------------------------
test('blank-slate first load renders the onboarding wizard on the detect rung', async ({
  page,
}) => {
  const errors = trackConsole(page)
  const statusHolder = { value: STATUS_BLANK }
  await stubBffForWizard(page, statusHolder)

  await page.goto('/')

  // The wizard renders its step indicator and the "Find Hermes" heading.
  await expect(page.getByRole('heading', { name: /Find Hermes/i })).toBeVisible()
  // The step indicator is present.
  await expect(page.getByRole('list', { name: /setup progress/i })).toBeVisible()
  // Continue is disabled until probe confirms installed.
  await expect(page.getByRole('button', { name: /Continue/i })).toBeDisabled()
  // The install command copy card is rendered.
  await expect(page.getByText(/curl -fsSL/i)).toBeVisible()
  // The skip affordance is always present.
  await expect(page.getByRole('button', { name: /Skip setup for now/i })).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 2 — detect rung: Re-check picks up installed state, Continue unlocks
// ---------------------------------------------------------------------------
test('detect rung: Re-check picks up installed Hermes, wizard auto-advances to connect', async ({
  page,
}) => {
  const errors = trackConsole(page)
  // Use a single mutable holder — advanced before Re-check so the refetch returns installed.
  const statusHolder = { value: STATUS_BLANK as object }
  await stubBffForWizard(page, statusHolder)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Find Hermes/i })).toBeVisible()
  // Continue is disabled on the detect rung when hermes is not installed.
  await expect(page.getByRole('button', { name: /Continue/i })).toBeDisabled()

  // Advance the probe BEFORE clicking Re-check so the refetch returns installed.
  statusHolder.value = STATUS_INSTALLED
  await page.getByRole('button', { name: /Re-check/i }).click()

  // The wizard auto-advances to the connect rung (the effect in OnboardingWizard
  // moves the user forward when the probe advances past their current rung).
  await expect(page.getByRole('heading', { name: /Connect a model/i })).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 3 — connect rung: API-key path is expandable and submittable
// ---------------------------------------------------------------------------
test('connect rung: the API-key expand path renders and is submittable', async ({ page }) => {
  const errors = trackConsole(page)
  // STATUS_INSTALLED has hermesInstalled=true, providerConnected=false → wizard resumes on connect.
  const statusHolder = { value: STATUS_INSTALLED }
  await stubBffForWizard(page, statusHolder)

  await page.goto('/')
  // The wizard resumes on the connect rung (hermes installed, no provider yet).
  await expect(page.getByRole('heading', { name: /Connect a model/i })).toBeVisible()

  // Expand the API-key section.
  await page.getByRole('button', { name: /Or paste an API key instead/i }).click()
  // Provider select is revealed.
  // The expanded section has two provider selects (oauth + key); the key form's one
  // is inside the expanded area (second combobox). Use a form-scoped selector.
  const keyPanel = page.locator('form').filter({ hasText: /Connect key/i })
  await expect(keyPanel).toBeVisible()

  // Select Anthropic in the key form's provider select.
  await keyPanel.getByRole('combobox').selectOption('anthropic')
  // Fill in a test key.
  const keyInput = keyPanel.getByPlaceholder('sk-...')
  await keyInput.fill('sk-test-key-1234')

  // The Connect key button becomes enabled.
  await expect(keyPanel.getByRole('button', { name: /Connect key/i })).toBeEnabled()

  // Submit the key — the stub returns connected:true and triggers a re-probe.
  // Advance the probe so after the POST the wizard sees providerConnected=true.
  // (The wizard auto-advances to identity rung when providerConnected becomes true.)
  statusHolder.value = { hermesInstalled: true, providerConnected: true, agentNamed: false }
  await keyPanel.getByRole('button', { name: /Connect key/i }).click()

  // The wizard auto-advances to the identity rung (same pattern as detect→connect).
  await expect(page.getByRole('heading', { name: /Give your agent a face/i })).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 4 — identity rung: avatar picker renders, Save & continue submits
// ---------------------------------------------------------------------------
test('identity rung: avatar picker + Save & continue fires the write and advances the wizard', async ({
  page,
}) => {
  const errors = trackConsole(page)
  // Both installed + connected, agent not named → wizard resumes on identity rung.
  // Keep agentNamed=false in the probe so the wizard stays open on the chat rung
  // after "Save & continue" (same pattern as the first-chat test).
  const statusHolder = {
    value: { hermesInstalled: true, providerConnected: true, agentNamed: false },
  }
  await stubBffForWizard(page, statusHolder)

  await page.goto('/')
  // The wizard resumes directly on the identity rung.
  await expect(page.getByRole('heading', { name: /Give your agent a face/i })).toBeVisible()

  // The preview name field and the AvatarPicker are present.
  await expect(page.getByLabel(/Nickname/i)).toBeVisible()
  await page.getByLabel(/Nickname/i).fill('Mercury')

  // Personality presets are HONEST about overwriting: the default ("Hermes
  // Default") shows no warning; choosing a replacing preset surfaces a clear
  // warning that it overwrites the default agent's SOUL.md.
  await expect(page.getByTestId('soul-replace-warning')).toHaveCount(0)
  await page.getByRole('radio', { name: /Coder/i }).click()
  await expect(page.getByTestId('soul-replace-warning')).toBeVisible()
  // Switch back to the safe default so the rest of the flow doesn't overwrite a soul.
  await page.getByRole('radio', { name: /Hermes Default/i }).click()
  await expect(page.getByTestId('soul-replace-warning')).toHaveCount(0)

  // The primary CTA on identity is "Save & continue".
  await expect(page.getByRole('button', { name: /Save & continue/i })).toBeVisible()
  await page.getByRole('button', { name: /Save & continue/i }).click()

  // The birth ceremony plays (the SAME HatchCeremony the Agents hub uses), then
  // its onDone advances the wizard. It is the success cue (replacing the toast).
  await expect(page.getByText(/has come to life|has hatched/i)).toBeVisible()

  // The wizard advances to the first-chat rung once the ceremony finishes (the
  // probe stays agentNamed=false so shouldShowWizard remains true).
  await expect(page.getByRole('heading', { name: /Say hello/i })).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 5 — first-chat rung: message input + Finish later skip path
// ---------------------------------------------------------------------------
test('first-chat rung: reached via Continue from identity, shows send input and Finish later', async ({
  page,
}) => {
  const errors = trackConsole(page)
  // Identity-rung starting state: installed + connected, but agent not named yet.
  // The wizard opens on identity; after clicking Continue it moves to the chat rung.
  // The probe KEEPS returning agentNamed=false so the wizard doesn't auto-close.
  const statusHolder = {
    value: { hermesInstalled: true, providerConnected: true, agentNamed: false },
  }
  await stubBffForWizard(page, statusHolder)

  await page.goto('/')
  // Wizard opens on the identity rung.
  await expect(page.getByRole('heading', { name: /Give your agent a face/i })).toBeVisible()

  // "Save & continue" on identity calls endow() → the birth ceremony → onContinue()
  // → go('chat'). The probe KEEPS returning agentNamed=false so the wizard stays open.
  await page.getByRole('button', { name: /Save & continue/i }).click()
  // The ceremony plays, then advances to the first-chat rung.
  await expect(page.getByText(/has come to life|has hatched/i)).toBeVisible()

  // The wizard is on the first-chat rung now.
  await expect(page.getByRole('heading', { name: /Say hello/i })).toBeVisible()
  // The message input is visible.
  await expect(page.getByLabel(/Message your agent/i)).toBeVisible()
  // The "Finish later" skip affordance is present.
  await expect(page.getByRole('button', { name: /Finish later/i })).toBeVisible()

  // Using Finish later dismisses the wizard and reveals the app shell.
  await page.getByRole('button', { name: /Finish later/i }).click()
  // The app shell renders — the connection dot is a reliable shell anchor.
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 6 — Skip setup for now also exits to the app shell
// ---------------------------------------------------------------------------
test('Skip setup for now on the detect rung exits the wizard, app shell renders', async ({
  page,
}) => {
  const errors = trackConsole(page)
  const statusHolder = { value: STATUS_BLANK }
  await stubBffForWizard(page, statusHolder)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Find Hermes/i })).toBeVisible()

  await page.getByRole('button', { name: /Skip setup for now/i }).click()

  // The app shell is now rendered; the wizard heading is gone.
  await expect(page.getByTestId('connection-dot')).toBeVisible()
  // After skip, the wizard takeover is gone — the Home or Chat shell is visible.
  // The "Find Hermes" heading belongs to the wizard, not the app shell.
  await expect(page.getByRole('heading', { name: /Find Hermes/i })).toHaveCount(0)

  expect(errors).toEqual([])
})
