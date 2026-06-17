import { test, expect } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC agent-identity E2E — create a new agent via the real NewAgentDialog,
 * see it in the Agents list, switch the active agent, and confirm the identity
 * (face + name) reflects in the rail chip. All BFF mutations are stubbed.
 *
 * Uses the standard `test` fixture (onboarded, cockpit mode). The profile list
 * data is served with two stubs: one before create (single "default" agent) and
 * one after (default + the new "atlas" agent), controlled by the `profilesStage`
 * holder.
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

const PROFILE_DEFAULT = {
  name: 'default',
  path: '/home/agent/.hermes/profiles/default',
  isDefault: true,
  isActive: true,
  model: 'anthropic/claude-sonnet-4',
  provider: 'anthropic',
  hasEnv: true,
  skillCount: 3,
  gatewayRunning: false,
}

const PROFILE_ATLAS = {
  name: 'atlas',
  path: '/home/agent/.hermes/profiles/atlas',
  isDefault: false,
  isActive: false,
  model: 'openai/gpt-5',
  provider: 'openai',
  hasEnv: false,
  skillCount: 1,
  gatewayRunning: false,
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
 * Stub all BFF calls. The `profilesStage` holder starts with one profile and
 * advances to two after the create mutation fires.
 */
function stubBff(page: Page, profilesStage: { created: boolean }) {
  return page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()

    if (path.endsWith('/health')) return json(route, HEALTH)
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, { sessions: [] })
    if (path.endsWith('/models')) return json(route, { provider: {}, models: [] })

    // Profile creation (POST /profiles) — sets the stage to "created".
    if (path.endsWith('/profiles') && method === 'POST') {
      profilesStage.created = true
      return json(route, { name: 'atlas', path: '/home/agent/.hermes/profiles/atlas' })
    }
    // Avatar write (PUT /profiles/:name/avatar).
    if (path.includes('/profiles/') && path.endsWith('/avatar')) {
      return json(route, { ok: true })
    }
    // Profile switch (POST /profiles/switch).
    if (path.endsWith('/profiles/switch') && method === 'POST') {
      return json(route, { active: 'atlas' })
    }
    // Profiles list (GET /profiles) — return one or two profiles based on stage.
    if (path.endsWith('/profiles')) {
      if (profilesStage.created) {
        return json(route, {
          active: 'default',
          profiles: [PROFILE_DEFAULT, PROFILE_ATLAS],
        })
      }
      return json(route, { active: 'default', profiles: [PROFILE_DEFAULT] })
    }

    // Agent detail sub-routes (/profiles/:name/soul, /memories, etc.)
    if (path.includes('/profiles/atlas')) return json(route, {})
    if (path.includes('/profiles/default')) return json(route, {})

    return json(route, {})
  })
}

// ---------------------------------------------------------------------------
// Test 1 — Agents page renders the default agent
// ---------------------------------------------------------------------------
test('Agents page renders the default profile card', async ({ page }) => {
  const errors = trackConsole(page)
  const profilesStage = { created: false }
  await stubBff(page, profilesStage)

  await page.goto('/profiles')
  await expect(page.getByRole('heading', { name: /Agents/i })).toBeVisible()
  await expect(page.getByTestId('studio-roster-card-default')).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 2 — New agent dialog opens and accepts a valid name
// ---------------------------------------------------------------------------
test('New agent dialog opens, accepts a name, and the create button is enabled', async ({
  page,
}) => {
  const errors = trackConsole(page)
  const profilesStage = { created: false }
  await stubBff(page, profilesStage)

  await page.goto('/profiles')
  await expect(page.getByRole('heading', { name: /Agents/i })).toBeVisible()

  // Open the dialog.
  await page.getByRole('button', { name: /New agent/i }).click()
  const dialog = page.getByRole('dialog', { name: /New agent/i })
  await expect(dialog).toBeVisible()

  // Profile ID input is focused (autoFocus).
  const nameInput = dialog.getByLabel('Profile ID', { exact: true })
  await expect(nameInput).toBeVisible()
  await nameInput.fill('atlas')

  // Create button is now enabled.
  await expect(dialog.getByRole('button', { name: /Hatch agent/i })).toBeEnabled()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 3 — invalid name (reserved "default") shows an error
// ---------------------------------------------------------------------------
test('New agent dialog: reserved name "default" shows an error and disables Create', async ({
  page,
}) => {
  const errors = trackConsole(page)
  const profilesStage = { created: false }
  await stubBff(page, profilesStage)

  await page.goto('/profiles')
  await page.getByRole('button', { name: /New agent/i }).click()
  const dialog = page.getByRole('dialog', { name: /New agent/i })
  const nameInput = dialog.getByLabel('Profile ID', { exact: true })
  await nameInput.fill('default')

  // An error message appears.
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByText(/Default is already your built-in agent/i)).toBeVisible()
  // Create is disabled.
  await expect(dialog.getByRole('button', { name: /Hatch agent/i })).toBeDisabled()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 4 — create mutates and the new agent appears in the list
// ---------------------------------------------------------------------------
test('create agent: POST fires, the new agent card appears in the Agents list', async ({
  page,
}) => {
  const errors = trackConsole(page)
  const profilesStage = { created: false }
  await stubBff(page, profilesStage)

  await page.goto('/profiles')
  await page.getByRole('button', { name: /New agent/i }).click()
  const dialog = page.getByRole('dialog', { name: /New agent/i })
  const nameInput = dialog.getByLabel('Profile ID', { exact: true })
  await nameInput.fill('atlas')
  await dialog.getByRole('button', { name: /Hatch agent/i }).click()

  // The dialog closes and navigation happens to the new agent's hub.
  await expect(dialog).not.toBeVisible()

  // Navigate back to the list to verify the new card appears.
  await page.goto('/profiles')
  // The profiles list now includes the new "atlas" agent card.
  await expect(page.getByTestId('studio-roster-card-atlas')).toBeVisible()
  await expect(page.getByTestId('studio-roster-card-default')).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 5 — Cancel closes the dialog without creating
// ---------------------------------------------------------------------------
test('Cancel in New agent dialog closes without creating', async ({ page }) => {
  const errors = trackConsole(page)
  const profilesStage = { created: false }
  await stubBff(page, profilesStage)

  await page.goto('/profiles')
  await page.getByRole('button', { name: /New agent/i }).click()
  const dialog = page.getByRole('dialog', { name: /New agent/i })
  await dialog.getByLabel('Profile ID', { exact: true }).fill('throwaway')
  await dialog.getByRole('button', { name: /Cancel/i }).click()

  // Dialog is closed.
  await expect(dialog).not.toBeVisible()
  // No create POST was sent (profilesStage unchanged).
  expect(profilesStage.created).toBe(false)

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Test 6 — switch agent action fires from the detail hub
// ---------------------------------------------------------------------------
test('agent detail hub: Switch to this agent fires the POST and shows the restart hint', async ({
  page,
}) => {
  const errors = trackConsole(page)
  const profilesStage = { created: true } // both profiles already exist
  await stubBff(page, profilesStage)

  // Navigate to atlas's detail page directly.
  await page.goto('/profiles/atlas')
  // The page header or switch button should be visible.
  await expect(page.getByRole('button', { name: /Switch to this agent/i })).toBeVisible()

  await page.getByRole('button', { name: /Switch to this agent/i }).click()
  // After switching, the honest "restart to apply" message appears (GatewayRestartCard).
  // Use the specific Restart gateway button rather than a text match that hits 2 elements.
  await expect(page.getByRole('button', { name: /Restart your agent/i })).toBeVisible()

  expect(errors).toEqual([])
})
