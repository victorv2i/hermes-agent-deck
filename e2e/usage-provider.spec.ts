import { test, expect } from './fixtures'
import type { Page, ConsoleMessage, Route } from '@playwright/test'

/**
 * HERMETIC Usage breakdown-toggle e2e — drives the "By model / By provider"
 * segmented control on /usage with NO live backend. Every `/api/agent-deck/**`
 * REST call is stubbed at the browser network layer via `page.route()`, so the
 * spec is deterministic regardless of whether the gateway or dashboard is
 * running. It runs against the mock web instance (:5199), reusing the chat
 * project's webServer pair — the same harness as surfaces.spec.ts.
 *
 * Coverage:
 *   - clicking "By provider" swaps the bottom breakdown to the provider rollup
 *     (ProviderBreakdown) and "By model" swaps it back (ModelBreakdown),
 *   - the radiogroup honors arrow-key selection with the roving-tabindex pattern
 *     (only the checked radio is Tab-focusable; arrows move selection + focus),
 *   - the surface stays console-clean across the interaction.
 *
 * Companion to surfaces.spec.ts's shallow `/usage` render — this is the
 * INTERACTION pass for the breakdown grouping control.
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
const ISO = new Date(NOW * 1000).toISOString()

const MODELS = {
  activeModelId: 'anthropic/claude-sonnet-4',
  provider: { id: 'anthropic', label: 'Anthropic' },
  reasoningEffort: 'medium',
  scope: 'global',
  hasChannelOverride: false,
  models: [
    {
      id: 'anthropic/claude-sonnet-4',
      label: 'Claude Sonnet 4',
      provider: 'anthropic',
      active: true,
      source: 'config',
    },
  ],
}

/**
 * Two models from distinct vendors with recorded `billingProvider` attribution,
 * so the per-provider rollup (groupByProvider) yields two honest, brand-named
 * rows rather than a single "Unattributed" bucket — proving the toggle truly
 * swapped to the provider view.
 */
const USAGE = {
  periodDays: 7,
  totals: {
    inputTokens: 18000,
    outputTokens: 6000,
    cacheReadTokens: 800,
    reasoningTokens: 200,
    estimatedCost: 0.66,
    actualCost: 0.6,
    sessions: 7,
  },
  daily: [
    {
      day: ISO.slice(0, 10),
      inputTokens: 18000,
      outputTokens: 6000,
      cacheReadTokens: 800,
      reasoningTokens: 200,
      estimatedCost: 0.66,
      actualCost: 0.6,
      sessions: 7,
    },
  ],
  byModel: [
    {
      model: 'anthropic/claude-sonnet-4',
      inputTokens: 12000,
      outputTokens: 4000,
      estimatedCost: 0.42,
      sessions: 5,
      billingProvider: 'anthropic',
    },
    {
      model: 'openai/gpt-5',
      inputTokens: 6000,
      outputTokens: 2000,
      estimatedCost: 0.24,
      sessions: 2,
      billingProvider: 'openai',
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

/** Stub every `/api/agent-deck/**` REST call so no live BFF/dashboard is hit. */
async function stubBff(page: Page) {
  await page.route('**/api/agent-deck/**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path.endsWith('/health')) return json(route, HEALTH)

    // Organization (Agent Deck's own project/tag store) — the rail's
    // `['organization']` query needs a well-formed store; a bare `{}` would crash it.
    if (path.endsWith('/organization') && !path.includes('/sessions/')) {
      return json(route, { projects: [], assignments: {} })
    }
    if (path.endsWith('/organization')) return json(route, { projectId: null, tags: [] })

    if (path.endsWith('/models')) return json(route, MODELS)

    // Usage (carries a ?days= query).
    if (path.endsWith('/usage')) return json(route, USAGE)

    // Anything else: a harmless empty 200 so a stray probe never 404-noises.
    return json(route, {})
  })
}

/** Collect console errors + page errors so the spec can assert it stayed clean. */
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

test('Usage breakdown toggle: click "By provider" swaps to the provider rollup and back, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await page.goto('/usage')

  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()

  // The breakdown control is an ARIA radiogroup; "By model" is the default view.
  const group = page.getByRole('radiogroup', { name: /Breakdown grouping/i })
  await expect(group).toBeVisible()
  const byModel = group.getByRole('radio', { name: 'By model' })
  const byProvider = group.getByRole('radio', { name: 'By provider' })

  // Default: the per-model breakdown is shown; the per-provider rollup is not yet
  // mounted. The unique per-view legend testid is the load-bearing proof of which
  // card is mounted (CardTitle is a styled <div>, not a heading, and its "By
  // model" text collides with the radio label — so the legend testid is the
  // unambiguous anchor).
  await expect(byModel).toBeChecked()
  await expect(byProvider).not.toBeChecked()
  await expect(page.getByTestId('model-breakdown-legend')).toBeVisible()
  await expect(page.getByTestId('provider-breakdown-legend')).toHaveCount(0)

  // Click "By provider" → the ProviderBreakdown card replaces ModelBreakdown.
  await byProvider.click()
  await expect(byProvider).toBeChecked()
  await expect(byModel).not.toBeChecked()
  await expect(page.getByTestId('provider-breakdown-legend')).toBeVisible()
  // The provider rollup content renders: the two distinct billingProviders fold
  // into two honest brand-named rows (Anthropic + OpenAI), not "Unattributed".
  const providerLabels = page.getByTestId('provider-row-label')
  await expect(providerLabels).toHaveCount(2)
  await expect(providerLabels.filter({ hasText: 'Anthropic' })).toBeVisible()
  await expect(providerLabels.filter({ hasText: 'OpenAI' })).toBeVisible()
  // The per-model card is gone now that the provider view is active.
  await expect(page.getByTestId('model-breakdown-legend')).toHaveCount(0)

  // Click "By model" → swap back to the per-model breakdown.
  await byModel.click()
  await expect(byModel).toBeChecked()
  await expect(page.getByTestId('model-breakdown-legend')).toBeVisible()
  await expect(page.getByTestId('provider-breakdown-legend')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('Usage breakdown toggle: arrow keys move selection with roving tabindex, console-clean', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await page.goto('/usage')

  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()

  const group = page.getByRole('radiogroup', { name: /Breakdown grouping/i })
  const byModel = group.getByRole('radio', { name: 'By model' })
  const byProvider = group.getByRole('radio', { name: 'By provider' })

  // Roving tabindex: only the checked radio (the default "By model") is in the
  // tab order; the unchecked one is removed from it.
  await expect(byModel).toHaveAttribute('tabindex', '0')
  await expect(byProvider).toHaveAttribute('tabindex', '-1')

  // Focus the checked radio and press ArrowRight — selection (and focus) moves to
  // "By provider", which swaps the breakdown to the provider rollup.
  await byModel.focus()
  await page.keyboard.press('ArrowRight')
  await expect(byProvider).toBeChecked()
  await expect(byProvider).toBeFocused()
  await expect(byProvider).toHaveAttribute('tabindex', '0')
  await expect(byModel).toHaveAttribute('tabindex', '-1')
  await expect(page.getByTestId('provider-breakdown-legend')).toBeVisible()

  // ArrowLeft moves selection back to "By model" (the model breakdown returns).
  await page.keyboard.press('ArrowLeft')
  await expect(byModel).toBeChecked()
  await expect(byModel).toBeFocused()
  await expect(page.getByTestId('model-breakdown-legend')).toBeVisible()

  expect(errors).toEqual([])
})
