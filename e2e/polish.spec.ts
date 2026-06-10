import { test, expect } from './fixtures'
import type { Page, Route, ConsoleMessage } from '@playwright/test'

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
 * HERMETIC M5-polish e2e — the command palette, the global keyboard shortcuts,
 * and the responsive (mobile) slide-over rail. REST is stubbed at the browser
 * layer (no live BFF/dashboard), so these are deterministic. Runs on the shared
 * mock web instance (:5199), like the surfaces project.
 */

const SESSIONS = {
  total: 1,
  sessions: [
    {
      id: 'sess-1',
      source: 'cli',
      model: 'anthropic/claude-sonnet-4',
      title: 'Refactor the parser',
      preview: 'help me refactor',
      started_at: 1,
      last_active: 1,
      message_count: 2,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: null,
      is_active: false,
    },
  ],
}

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function stubBff(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/health')) return json(route, HEALTH)
    // The rail's organization store (drives render-time Object.values) must be a
    // well-formed empty store, not the catch-all {} below.
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return json(route, { projects: [], assignments: {} })
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return json(route, { results: [] })
    if (path.endsWith('/sessions')) return json(route, SESSIONS)
    return json(route, {})
  })
}

/** Collect console errors + page errors so each test can assert it stayed clean. */
function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.beforeEach(async ({ page }) => {
  await stubBff(page)
})

async function waitForShell(page: Page) {
  await expect(page.getByTestId('connection-dot')).toBeVisible()
}

test('command palette opens on Ctrl/Cmd+K, jumps to a surface', async ({ page }) => {
  const errors = trackConsole(page)
  await page.goto('/chat')
  await waitForShell(page)
  await page.keyboard.press('Control+K')

  const palette = page.getByRole('combobox', { name: /command menu/i })
  await expect(palette).toBeVisible()

  // Jump to the Files surface from the palette.
  await palette.fill('files')
  await page.getByRole('option', { name: /Files/ }).click()
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()

  expect(errors).toEqual([])
})

test('? opens the keyboard shortcuts overlay; Esc closes it', async ({ page }) => {
  const errors = trackConsole(page)
  await page.goto('/chat')
  await waitForShell(page)
  await page.getByRole('heading', { name: /What are we building/i }).click()
  await page.keyboard.press('?')
  const overlay = page.getByRole('dialog', { name: /keyboard shortcuts/i })
  await expect(overlay).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  expect(errors).toEqual([])
})

test('palette opens a session and lands on the history route', async ({ page }) => {
  const errors = trackConsole(page)
  await page.goto('/chat')
  await waitForShell(page)
  await page.keyboard.press('Control+K')
  const palette = page.getByRole('combobox', { name: /command menu/i })
  await palette.fill('parser')
  await page.getByRole('option', { name: /Refactor the parser/ }).click()
  await expect(page).toHaveURL(/\/sessions\/sess-1/)

  expect(errors).toEqual([])
})

test('mobile: the rail collapses to a slide-over opened by the menu button', async ({ page }) => {
  const errors = trackConsole(page)
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/chat')

  const rail = page.locator('nav[aria-label="Sidebar"]').first()
  await expect(rail).toHaveAttribute('data-mobile-open', 'false')
  await expect(rail).toHaveAttribute('aria-hidden', 'true')
  await expect(rail).toHaveAttribute('inert', '')

  await page.getByRole('button', { name: /open navigation/i }).click()
  const openRail = page.getByRole('navigation', { name: /sidebar/i })
  await expect(openRail).toHaveAttribute('data-mobile-open', 'true')
  await expect(openRail).not.toHaveAttribute('aria-hidden', 'true')
  await expect(openRail.getByRole('button', { name: /new chat/i })).toBeVisible()

  // The backdrop dismisses the slide-over.
  await page.getByTestId('mobile-rail-backdrop').click()
  await expect(rail).toHaveAttribute('data-mobile-open', 'false')
  await expect(rail).toHaveAttribute('aria-hidden', 'true')
  await expect(rail).toHaveAttribute('inert', '')

  expect(errors).toEqual([])
})
