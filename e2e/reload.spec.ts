import { test, expect as baseExpect, MOCK_MODELS } from './fixtures'
import type { Page, ConsoleMessage } from '@playwright/test'

// Every wait in this spec anchors on a STABLE marker (a streamed text, the
// approval card, the composer state) — correctness, not latency, is under test.
// Under full-suite parallel load on a contended box (Playwright sizes its worker
// pool from the full CPU count, so a constrained run oversubscribes heavily) the
// mock-paced milestones legitimately exceed the 5s default, so the whole spec
// rides a wide per-assertion budget instead of sprinkling ad-hoc timeouts.
const expect = baseExpect.configure({ timeout: 30_000 })

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
 * HERMETIC reload-mid-stream e2e — the P0.1 runtime-truth proof, end-to-end.
 *
 * The run pump is SERVER-OWNED (apps/server/src/chat/runManager.ts): a browser
 * reload mid-stream tears down the socket, but the BFF keeps draining the
 * gateway SSE into its RunStore. On reload the web client adopts the persisted
 * {runId, lastCursor} from sessionStorage and auto-`resume`s the WHOLE run from
 * cursor 0 (the reload lost the in-memory transcript), rebuilding the live
 * conversation and tailing the rest. So a tab reload mid-run is free: the run
 * finishes and the full reply is present.
 *
 * Rides the same in-process MOCK gateway as chat.spec.ts (no live :8643), so
 * it's part of the `pnpm verify` gate. The scripted run streams text → a tool
 * chip → an approval (pauses) → on Allow: final text → run.completed.
 */

function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Stub the dashboard-backed REST the app fires on load (model picker, rail
 * sessions, status/config) with minimal valid bodies, so the reload proof is
 * HERMETIC: the run rides the real mock `/socket.io` flow (NOT matched by this
 * `/api/agent-deck/**` glob) while the load-time REST never proxies to the hermes
 * dashboard (:9123). The reload spec only asserts the run's durability, so it must
 * stay console-clean whether or not the dashboard is up.
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
    // The rail's organization store (drives render-time Object.values) must be a
    // well-formed empty store, not the catch-all {} below.
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

test('reload mid-stream AFTER a fork keeps the run alive, does not duplicate events, and never lets branch state overwrite the resume cursor', async ({
  page,
}) => {
  // This is the heaviest cockpit flow: a full run → fork → second run → mid-stream
  // FULL PAGE RELOAD → server-owned-pump reconnect + replay-from-cursor to a second
  // approval. Under full-suite parallel load (many surfaces specs share one mock BFF,
  // serializing the socket replay) that resume legitimately runs long, though it passes
  // 3/3 isolated in ~4s. Give it a firm, explicit 120s budget — the guarantee under test
  // is correctness (the run survives + resumes), NOT latency — with wide post-reload waits.
  test.setTimeout(120_000)
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  // Run to completion so there is a SETTLED message to fork from.
  await sendMessage(page, 'Say hi and clean the build')
  await expect(page.getByText('Taking a look at the build folder first.')).toBeVisible()
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await approval.getByRole('button', { name: /allow once/i }).click()
  await expect(
    page.getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    ),
  ).toBeVisible()

  // Fork from the FINAL assistant reply (the live head) — a head-fork. Scope to
  // the VISIBLE message bubble (the sr-only live region carries the same text).
  await page
    .getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    )
    .and(page.locator(':visible'))
    .first()
    .hover()
  await page.getByRole('button', { name: 'Fork from here' }).first().click()
  await expect(page.getByTestId('fork-banner')).toBeVisible()

  // Send ON the fork — a fresh run streams onto the fork branch.
  await sendMessage(page, 'Continue from the fork')
  await expect(page.getByText('Continue from the fork')).toBeVisible()
  // Wait until the fork's run is genuinely IN FLIGHT, then reload MID-stream —
  // BEFORE it reaches the approval (the same shape as the non-fork reload test
  // below). Anchor on the composer flipping to Stop: that fires at run.started, so
  // the run exists server-side (resumable by runId) and we reload before the ~120ms
  // approval. (A streamed-text anchor is unusable here — the original branch shows
  // the SAME words, so it would match the old reply and not the fork's new run.)
  await expect(page.getByTestId('composer-stop')).toBeVisible()

  // The reload-resume key holds ONLY {runId, lastCursor} — branch metadata never
  // leaked into it (honesty: branch draft storage is kept separate).
  const persisted = await page.evaluate(() =>
    window.sessionStorage.getItem('agent-deck:active-run'),
  )
  expect(persisted).not.toBeNull()
  const parsed = JSON.parse(persisted!) as Record<string, unknown>
  expect(Object.keys(parsed).sort()).toEqual(['lastCursor', 'runId'])

  // Full page reload mid-stream — the socket that issued the fork's run dies. If
  // the run were socket-owned it would abort here. The post-reload re-establish
  // (reconnect + full replay of the run) is genuinely heavier than a normal frame,
  // so allow a generous (30s) window before asserting — under full-suite parallel
  // load on a contended box the fork's reconnect+replay can exceed 15s. This is
  // latency, not a hang (it passes 3/3 isolated in ~4s); the guarantee under test is
  // "the run survives + resumes", NOT "within N seconds", so the window is wide.
  await page.reload()
  await expect(page.getByTestId('connection-dot')).toBeVisible({ timeout: 30000 })

  // The run was NOT lost (server-owned pump) and resumes: it keeps streaming after
  // reload and reaches its approval, replayed on resume.
  const approval2 = page.getByTestId('approval-card')
  await expect(approval2).toBeVisible({ timeout: 60000 })
  await expect(approval2).toContainText('rm -rf ./build')
  await approval2.getByRole('button', { name: /allow once/i }).click()
  await expect(approval2).toBeHidden()

  // The full reply is present exactly once (no duplicated frames) and the run is
  // finished (composer back to Send).
  await expect(
    page.getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    ),
  ).toHaveCount(1)
  await expect(page.getByTestId('composer-send')).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('a full page reload mid-stream keeps the run alive; it completes after reload', async ({
  page,
}) => {
  // Same wide-budget rationale as the fork test above: correctness, not latency,
  // is under test, and the post-reload re-establish runs long under parallel load.
  test.setTimeout(120_000)
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.goto('/chat')
  await expect(page.getByTestId('connection-dot')).toBeVisible()

  await sendMessage(page, 'Say hi and clean the build')

  // Wait until the run is actually streaming (the first tokens have arrived) so
  // the reload genuinely happens MID-stream, not before the run started.
  await expect(page.getByText(/Taking a look/)).toBeVisible()

  // Full page reload — the socket that issued the run is destroyed. If the run
  // were socket-owned, the BFF would abort the pump here and the run would die.
  // The reload may land BEFORE the approval frame (the resume replay then carries
  // it) or AFTER it (the persisted cursor is already past it, and the BFF
  // re-surfaces the still-pending approval as a transient frame on resume) —
  // both timings converge on the approval card below, so this wait is
  // deterministic regardless of where the reload lands in the stream.
  await page.reload()

  // After reload the client adopts the persisted run and auto-resumes. Because
  // the pump is server-owned, the run kept going while we were gone: the tool
  // chip and the approval prompt the run reaches are present post-reload.
  await expect(page.getByTestId('connection-dot')).toBeVisible({ timeout: 30_000 })
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible({ timeout: 30_000 })
  await expect(approval).toContainText('rm -rf ./build')

  // Resolve the approval → the run streams its closing text and completes.
  await approval.getByRole('button', { name: /allow once/i }).click()
  await expect(approval).toBeHidden()

  // The FULL reply is present — the streamed opening (replayed from the buffer
  // after reload) plus the post-approval closing — and the run is finished
  // (composer is back to Send, not Stop).
  await expect(
    page.getByText(
      'Taking a look at the build folder first. Build folder cleared. The repo is tidy and ready to ship.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(page.getByTestId('composer-send')).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)

  expect(errors).toEqual([])
})
