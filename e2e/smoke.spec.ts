import { test, expect } from './fixtures'

test('app loads in the warm-void AppShell, console-clean', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/chat')

  // Chat uses the SPLIT rail (spec §1): a slim header + an icon-nav + a
  // dedicated sessions pane → a true three-panel layout (ChatGPT/Claude shape).
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByTestId('icon-rail')).toBeVisible()
  // The dedicated sessions pane is the second column (default-open on desktop).
  await expect(page.getByTestId('sessions-pane')).toBeVisible()
  // The slim icon-nav has no room for the wordmark text, so it moves to the header.
  await expect(page.getByRole('banner').getByText('Agentdeck')).toBeVisible()
  await expect(page.getByRole('button', { name: /new chat/i })).toBeVisible()

  // Connection dot reflects the BFF health probe (online or offline, never crashes).
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  expect(errors).toEqual([]) // console-clean invariant
})

test('design language is applied: the default Clay & Sky theme (dark bg + dusty-blue accent)', async ({
  page,
}) => {
  await page.goto('/')

  // Default mode is dark; the default theme (Clay & Sky) lives at the bare :root,
  // so there is NO data-palette attribute in the resting DOM.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).not.toHaveAttribute('data-palette', /.+/)

  // Clay & Sky base background #16181C === rgb(22, 24, 28).
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(22, 24, 28)')

  // Dusty trust-blue action accent #7BA7D9 === rgb(123, 167, 217), exposed via --primary.
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  )
  expect(accent.toLowerCase()).toBe('#7ba7d9')
})

test('theme toggle flips data-theme to the default light theme (Clay & Sky light)', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('button', { name: /theme/i }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Clay & Sky light bg #F4F2EE === rgb(244, 242, 238).
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(244, 242, 238)')
})

test('the palette switcher applies a theme via data-palette and persists', async ({ page }) => {
  await page.goto('/settings')

  // The Settings theme picker is reachable regardless of config load state.
  await page.getByRole('radio', { name: /Warm Void/i }).click()

  // The classic teal theme is applied via data-palette + its base bg #041C1C.
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'warm-void')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(4, 28, 28)')

  // It persists across a reload with no flash (pre-paint guard stamps it).
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'warm-void')

  // Switching back to the default clears the attribute (clean DOM).
  await page.getByRole('radio', { name: /Clay & Sky/i }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-palette', /.+/)
})
