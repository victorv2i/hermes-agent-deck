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

/**
 * HERMETIC agent rich-content e2e — the BFF runs against the IN-PROCESS MOCK
 * gateway (scripts/serve-mock-gateway.mjs → :7899), the SAME hermetic pair the
 * chat spec uses. No live gateway is involved, so this is part of `pnpm verify`.
 *
 * The mock has an ADDITIVE rich-content path: when the user's input carries a
 * trigger phrase the agent streams a single rich-markdown reply (then finishes —
 * no tool chip, no approval), while EVERY OTHER input still streams the default
 * "Taking a look at the build folder first." run unchanged. This spec exercises:
 *   - "demo:table" → a GFM table that renders SORTABLE (column header buttons
 *     with aria-sort cycling ascending → descending; rows reorder type-aware).
 *   - "demo:image" → a markdown image that renders inline as a real <img>
 *     (an inline 1×1 data: PNG, so it loads with no network).
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
 * Stub the dashboard-backed REST the app fires on load (model picker `/models`,
 * the rail's `/sessions`, status/config/usage) with minimal valid bodies, so the
 * run is HERMETIC: the connection dot and the run itself ride the real mock
 * `/socket.io` flow (NOT matched by this `/api/agent-deck/**` glob), while the
 * load-time REST never proxies to the hermes dashboard. Mirrors chat.spec.ts.
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
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return fulfill({ projects: [], assignments: {} })
    if (path.endsWith('/organization')) return fulfill({ projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return fulfill({ results: [] })
    if (path.endsWith('/sessions')) return fulfill({ sessions: [] })
    return fulfill({})
  })
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await composer.click()
  await composer.fill(text)
  await page.getByTestId('composer-send').click()
}

test('a "demo:table" reply renders a SORTABLE GFM table: clicking a column header cycles aria-sort and reorders the rows', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')

  // Connected to the mock BFF.
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  await sendMessage(page, 'demo:table')

  // The agent's GFM table renders. The Score column is numeric, so a numeric
  // sort (1, 2, 10) — not lexical (1, 10, 2) — proves the rows actually reorder.
  const table = page.getByRole('table')
  await expect(table).toBeVisible()

  // Each header is a real, keyboard-operable button (the a11y contract).
  const nameHeader = page.getByRole('columnheader', { name: /Name/ })
  const scoreHeader = page.getByRole('columnheader', { name: /Score/ })
  const scoreButton = page.getByRole('button', { name: /Score/ })
  await expect(scoreButton).toBeVisible()

  // Document order before any sort: every header is aria-sort="none".
  await expect(scoreHeader).toHaveAttribute('aria-sort', 'none')
  await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
  const cells = () => table.getByRole('cell')
  // Original order: Bravo / Alpha / Charlie (first column of each body row).
  await expect(cells().filter({ hasText: /^Bravo$/ })).toBeVisible()

  // First click → ascending. Numeric sort: 1, 2, 10 → Charlie, Bravo, Alpha.
  await scoreButton.click()
  await expect(scoreHeader).toHaveAttribute('aria-sort', 'ascending')
  // The Name column now leads with Charlie (the row whose Score is 1).
  const firstBodyRow = table
    .getByRole('row')
    .filter({ has: page.getByRole('cell') })
    .first()
  await expect(firstBodyRow).toContainText('Charlie')

  // Second click → descending. Numeric: 10, 2, 1 → Alpha, Bravo, Charlie.
  await scoreButton.click()
  await expect(scoreHeader).toHaveAttribute('aria-sort', 'descending')
  await expect(firstBodyRow).toContainText('Alpha')

  // Only the active column carries a non-none aria-sort.
  await expect(nameHeader).toHaveAttribute('aria-sort', 'none')

  expect(errors).toEqual([])
})

test('a "demo:image" reply renders the agent\'s markdown image inline as an <img>', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')

  await expect(page.getByTestId('connection-dot')).toBeVisible()

  await sendMessage(page, 'demo:image')

  // The agent's markdown image (`![sales chart](data:image/png;base64,…)`)
  // renders inline as a real <img> with its honest alt text. The inline 1×1 PNG
  // loads (no network), so it is the thumbnail, never the broken-image fallback.
  const image = page.getByRole('img', { name: 'sales chart' })
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/)

  // The thumbnail is the keyboard-operable "enlarge" affordance (ChatImage wraps
  // the <img> in the lightbox trigger button), confirming it rendered as the
  // image path — not the honest link fallback shown when a source fails to load.
  await expect(page.getByRole('button', { name: /Enlarge image: sales chart/i })).toBeVisible()

  expect(errors).toEqual([])
})
