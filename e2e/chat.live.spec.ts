import { test, expect } from '@playwright/test'

/**
 * CONFIRMATORY LIVE SMOKE — NOT part of the `pnpm verify` gate.
 *
 * Drives a real "say hi" through the browser against the REAL agent-deck BFF
 * (default 5173 → 7878) talking to the live hermes gateway :8643, and confirms a
 * real streamed assistant reply renders. Run only when explicitly opted in:
 *
 *   AGENT_DECK_LIVE_SMOKE=1 pnpm e2e --project=live
 *
 * The gateway API key is read server-side by the BFF and never appears in the
 * browser or this test. Real LLM latency applies, hence the generous timeout.
 */
test('live: a real "say hi" streams a real reply in the browser', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/chat')

  // Socket should connect to the real BFF.
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await composer.click()
  await composer.fill('say hi in one short sentence')
  await page.getByTestId('composer-send').click()

  // The user's turn is echoed immediately.
  await expect(page.getByText('say hi in one short sentence')).toBeVisible()

  // While the real run streams, Send becomes Stop.
  await expect(page.getByTestId('composer-stop')).toBeVisible({ timeout: 15_000 })

  // The run completes → composer reverts to Send.
  await expect(page.getByTestId('composer-send')).toBeVisible({ timeout: 75_000 })
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)

  // A non-empty assistant turn rendered (full-width prose, no user bubble bg).
  // The last assistant prose block should carry some visible text.
  const proseBlocks = page.locator('.group\\/turn')
  const lastTurnText = (await proseBlocks.last().innerText()).trim()
  expect(lastTurnText.length).toBeGreaterThan(0)
})
