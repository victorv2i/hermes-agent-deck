import { test, expect } from './fixtures'
import type { Page, ConsoleMessage } from '@playwright/test'

/**
 * HERMETIC chat-media e2e (chat project) — the USER-sent image path is entirely
 * CLIENT-SIDE: the composer reads the picked file into an inline `data:image/...`
 * URL, the chat store appends the user turn WITH its attachment, and the
 * transcript renders that image in the user's bubble — all BEFORE (and
 * independent of) any gateway reply. So this spec never asserts the mock's
 * scripted text; it drives the file picker, sends, and checks what the user sees:
 * the sent image in their bubble, a click-to-enlarge lightbox, and the
 * no-empty-bubble image-only send. The streamed run itself is covered by
 * `chat.spec.ts`; here the mock reply is irrelevant (and a run is left to settle
 * via Stop where one starts).
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
 * A VISION-capable one-model roster. Mirrors the fixtures' MOCK_MODELS but adds
 * `capabilities.supportsVision: true`, because ChatRoute gates the attach button
 * on exactly that (`models.data?.capabilities?.supportsVision`). With vision on,
 * the attach affordance is ENABLED, so this spec exercises the honest end-to-end
 * path (attach is offered, not disabled). The hidden file input itself is always
 * present, but a vision roster keeps the surface truthful.
 */
const VISION_MODELS = {
  activeModelId: 'anthropic/claude-sonnet-4',
  provider: { id: 'anthropic', label: 'Anthropic' },
  models: [
    {
      id: 'anthropic/claude-sonnet-4',
      label: 'Claude Sonnet 4',
      provider: 'anthropic',
      active: true,
      source: 'config',
    },
  ],
  capabilities: { supportsVision: true },
}

/**
 * Stub the load-time REST the app fires (models / sessions / status / usage) with
 * minimal valid bodies so the surface is HERMETIC and console-clean whether or
 * not the dashboard is up. The `/models` body is the vision roster above so the
 * attach button is enabled. Mirrors `chat.spec.ts`'s stub, swapping in
 * VISION_MODELS for the picker.
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
    if (path.endsWith('/models')) return fulfill(VISION_MODELS)
    if (path.endsWith('/organization') && !path.includes('/sessions/'))
      return fulfill({ projects: [], assignments: {} })
    if (path.endsWith('/organization')) return fulfill({ projectId: null, tags: [] })
    if (path.includes('/search/sessions')) return fulfill({ results: [] })
    if (path.endsWith('/sessions')) return fulfill({ sessions: [] })
    return fulfill({})
  })
}

/**
 * A tiny but VALID 1x1 transparent PNG. The composer's `fileToAttachment` reads
 * the picked File via FileReader into a `data:image/png;base64,...` URL, which
 * must pass the bubble's `SAFE_IMAGE_DATA_URL` raster allow-list — so a real PNG
 * (not arbitrary bytes) is what reaches the transcript `<img>`. Decoded from the
 * canonical 1x1 transparent PNG base64.
 */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** Attach `name` (a 1x1 PNG) to the composer via the hidden native file input the
 * attach button proxies, then assert the removable preview pill shows the name. */
async function attachImage(page: Page, name: string) {
  await page.getByTestId('composer-file-input').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: PNG_1x1,
  })
  // The pending-attachment preview pill (above the input) confirms the file was
  // read + accepted before we send.
  await expect(page.getByTestId('composer-attachment-pill').filter({ hasText: name })).toBeVisible()
}

test('a user-sent image renders in the transcript, enlarges in a lightbox, and Esc closes it', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')

  // Connected to the mock BFF; the vision roster enables the attach affordance.
  await expect(page.getByTestId('connection-dot')).toBeVisible()
  await expect(page.getByTestId('composer-attach')).toBeEnabled()

  // Attach a PNG, type a short prose caption, and send.
  await attachImage(page, 'screenshot.png')
  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await composer.click()
  await composer.fill('Look at this')
  await page.getByTestId('composer-send').click()

  // The user's prose echoes AND the sent image lands in their bubble as an <img>
  // whose accessible name is the attachment's filename (its alt). This is the
  // sent image staying visible after send — not a "Sent an image" label.
  await expect(page.getByText('Look at this')).toBeVisible()
  const sentImage = page.getByRole('img', { name: 'screenshot.png' })
  await expect(sentImage).toBeVisible()

  // Clicking the thumbnail opens the accessible lightbox dialog (radix Dialog →
  // role="dialog"). The enlarge button wraps the thumbnail.
  await page.getByRole('button', { name: 'Enlarge image: screenshot.png' }).click()
  const lightbox = page.getByRole('dialog')
  await expect(lightbox).toBeVisible()
  // The enlarged image is present inside the dialog (same alt).
  await expect(lightbox.getByRole('img', { name: 'screenshot.png' })).toBeVisible()

  // Esc closes the lightbox (the Dialog primitive's Escape-to-close contract).
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The thumbnail is still in the transcript after closing.
  await expect(sentImage).toBeVisible()

  // The composer cleared its attachments + text on send (no leftover pill).
  await expect(page.getByTestId('composer-attachment-pill')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('an image-only send (no prose) shows just the image — no empty text bubble', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // Attach an image but type NO prose, then send (an image-only turn is valid —
  // the agent sees the image).
  await attachImage(page, 'diagram.png')
  await page.getByTestId('composer-send').click()

  // The sent image renders in the user's bubble (exactly one — the one we sent).
  const sentImage = page.getByRole('img', { name: 'diagram.png' })
  await expect(sentImage).toBeVisible()
  await expect(page.getByRole('img', { name: 'diagram.png' })).toHaveCount(1)

  // NO empty user text bubble: Message.tsx renders the user prose bubble only
  // when `content.length > 0 || attachments.length === 0`, so an image-only turn
  // (empty content + an attachment) renders NONE. The user prose bubble is the
  // sole `.bg-surface-2.whitespace-pre-wrap` surface (a tool card's collapsed
  // `<pre>` is whitespace-pre-wrap but not bg-surface-2; the inline editor is
  // bg-surface-2 but not whitespace-pre-wrap), so a count of 0 proves the
  // image-only turn shows just the image — never a hollow bubble.
  await expect(page.locator('.bg-surface-2.whitespace-pre-wrap')).toHaveCount(0)
  await expect(page.getByTestId('composer-attachment-pill')).toHaveCount(0)

  // The image-only send fired a run; stop it so the test settles deterministically
  // (the scripted run would otherwise pause at an approval). If it already settled,
  // Send is back — either way we end idle.
  const stop = page.getByTestId('composer-stop')
  if (await stop.isVisible()) await stop.click()
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // The image survived the run lifecycle (still the one sent thumbnail).
  await expect(sentImage).toBeVisible()

  expect(errors).toEqual([])
})
