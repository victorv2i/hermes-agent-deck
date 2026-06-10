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
 * HERMETIC reconnect-DURING-an-in-flight-tool e2e — the durability proof at its
 * sharpest: the socket transport drops WHILE a tool call is still running (not a
 * full page reload — the page stays alive, only the link dies), and on reconnect
 * the in-flight tool is replayed exactly once and the run continues to completion
 * with no double-counting and no error flash.
 *
 * Why this is distinct from reload.spec (and the higher-value gap it closes):
 *   - reload.spec destroys the whole tab (remount + sessionStorage adopt) and the
 *     drop lands at the approval PAUSE — a clean, post-tool boundary.
 *   - THIS spec keeps the live page and drops only the WebSocket transport, mid
 *     tool — the messy real-world failure (flaky wifi, laptop sleep, proxy hiccup)
 *     mid-run. socket.io auto-reconnects in place and the ChatSocket's `connect`
 *     handler auto-emits resume({ run_id, after_cursor: lastCursor }); the
 *     server-owned RunManager pump kept draining the gateway SSE into the RunStore
 *     the whole time we were offline, so the resume replays exactly the frames we
 *     missed (the tool's completion + the approval) and the cursor de-dup makes
 *     the overlap idempotent — the inline bash ToolCard is upserted in place, it
 *     does NOT spawn a second chip.
 *
 * The drop is forced with Playwright's context offline toggle (a genuine
 * transport drop, observable on the connection dot leaving `online`), so it is
 * fully hermetic and deterministic — no live gateway, no compression-event
 * harness gymnastics (the in-process mock has no compression frame to simulate,
 * so compression is intentionally out of scope here; this spec targets the
 * reconnect-mid-tool gap, which the mock DOES drive deterministically).
 *
 * Rides the same in-process MOCK gateway as chat.spec.ts (no live :8643): the
 * scripted run streams text → a bash tool chip → an approval (pauses) → on Allow:
 * final text → run.completed. We snap the drop onto the in-flight tool the instant
 * its timeline row appears; the deterministic invariant we hold is the RUN being
 * in flight (it stays running through the tool up to the approval), so the proof
 * never depends on catching the tool's sub-60ms running→completed flip from the
 * browser — only on the run being pre-terminal when the link dies.
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
 * Stub the dashboard-backed REST the app fires on load with minimal valid
 * bodies, so the proof is HERMETIC: the run rides the real mock `/socket.io`
 * flow (NOT matched by this `/api/agent-deck/**` glob) while the load-time REST
 * never proxies to the hermes dashboard (:9123). This spec only asserts the
 * run's durability across a transport drop, so it must stay console-clean
 * whether or not the dashboard is up.
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

test('a socket drop while a tool is still running auto-reconnects in place: the in-flight tool replays once and the run completes — no double-count, no error flash', async ({
  page,
  context,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)

  await page.goto('/chat')
  const dot = page.getByTestId('connection-dot')
  await expect(dot).toHaveAttribute('data-status', 'online')

  // Start the run. The scripted mock streams text → tool.started(bash) → (60ms) →
  // tool.completed → (60ms) → approval.request (PAUSE). Tool calls render INLINE
  // in the transcript as ToolCards (the toolcard-trigger shows a friendly action
  // label; the raw tool name is revealed in its expanded detail panel).
  await sendMessage(page, 'Say hi and clean the build')

  // Wait for the bash tool call to land inline — the in-flight tool we will drop
  // the link underneath. The mock streams tool.started the instant the run begins
  // (its completion is ~60ms later), so synchronizing on the chip's appearance
  // lands the drop in the mid-tool window. The DETERMINISTIC invariant we anchor
  // on is the RUN being in flight (it stays running until the approval is
  // resolved — long after the tool); the running/completed flip is a sub-60ms
  // race the harness can't pin from the browser, so the durability assertions
  // below do not depend on it: whether the chip is mid-run or completed at drop
  // time, the run is pre-terminal and the resume-replay is the behavior tested.
  const bashChip = page.getByTestId('toolcard-trigger')
  await expect(bashChip).toBeVisible()

  // The run is genuinely in flight (deterministic: it stays running through the
  // tool and right up to the approval pause). The composer's Stop is the anchor.
  await expect(page.getByTestId('composer-stop')).toBeVisible()

  // --- DROP THE SOCKET MID-TOOL (transport only; the page stays alive) ---------
  // A real transport drop, observable on the connection dot. The server-owned
  // RunManager pump keeps draining the gateway SSE into the RunStore while we're
  // gone, so the run does NOT die — durability in fact, not just in name.
  await context.setOffline(true)
  await expect(dot).not.toHaveAttribute('data-status', 'online')
  // The run is still considered in flight on the live (but disconnected) page —
  // the drop did not abort it (a disconnect must never abort a server-owned run).
  await expect(page.getByTestId('composer-stop')).toBeVisible()

  // --- RECONNECT --------------------------------------------------------------
  // socket.io auto-reconnects; the ChatSocket's `connect` handler auto-emits
  // resume({ run_id, after_cursor: lastCursor }) and the BFF replays everything
  // we missed while offline (the tool's completion + the approval), then tails.
  await context.setOffline(false)
  // Generous timeout: socket.io reconnects on an exponential backoff
  // (reconnectionDelay 1s → reconnectionDelayMax 5s, randomized), so the dot can
  // take several seconds to flip back to `online` after we come online. This wait
  // is for the BACKOFF SCHEDULE, not a hang — the reconnect is inevitable
  // (reconnectionAttempts defaults to Infinity).
  await expect(dot).toHaveAttribute('data-status', 'online', { timeout: 20_000 })

  // 1) The in-flight tool REPLAYED EXACTLY ONCE — no double-count. The bash chip
  //    is upserted IN PLACE (cursor de-dup + tool-name upsert); a duplicate would
  //    show a SECOND bash chip.
  await expect(bashChip).toHaveCount(1)

  // 2) The run CONTINUED past the drop: the approval the pump reached while we
  //    were offline is now surfaced (replayed on resume) inline in the transcript.
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await expect(approval).toContainText('rm -rf ./build')

  // Resolve it → the run streams its closing text and completes.
  await approval.getByRole('button', { name: /allow once/i }).click()
  await expect(approval).toBeHidden()

  // 3) The FULL reply is present (streamed opening, replayed across the drop,
  //    plus the post-approval closing) and the run is finished — composer back to
  //    Send.
  await expect(
    page.getByText('Hello, from the mock agent. All done. Anything else?', { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('composer-send')).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)

  // 4) NO ERROR FLASH the entire time: the transcript's error alert never
  //    rendered and the console stayed clean. The reconnect was seamless.
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})
