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
 * HERMETIC resume-across-sessions e2e — the "Continue this session" loop,
 * end-to-end, against the IN-PROCESS MOCK gateway (no live :8643).
 *
 * Flow under test:
 *   1. The Sessions History "Continue" navigates the Chat surface to
 *      `/chat?continue=<id>`.
 *   2. App consumes that param: loads the session's transcript (stubbed REST),
 *      seeds it into the chat store, and remembers the session id.
 *   3. The user's NEXT send forwards `session_id` on the `run` command, so the
 *      new turn lands in the SAME hermes session — and the scripted mock run
 *      streams its reply BELOW the preserved prior transcript.
 *
 * The session-detail/messages REST is stubbed at the browser layer; the run
 * itself rides the real mock `/chat-run` socket on the mock BFF (:5199 → :7899).
 */

const NOW = Math.floor(Date.now() / 1000)

const SESSION_MESSAGES = {
  session_id: 'sess-1',
  messages: [
    {
      id: '1',
      role: 'user',
      content: 'refactor the parser please',
      timestamp: NOW,
      reasoning: null,
      tool_name: null,
      tool_calls: [],
    },
    {
      id: '2',
      role: 'assistant',
      content: 'Sure, here is the plan.',
      timestamp: NOW,
      reasoning: null,
      tool_name: null,
      tool_calls: [],
    },
  ],
}

const SESSION_DETAIL = {
  id: 'sess-1',
  source: 'cli',
  model: 'openai/gpt-5.5',
  title: 'Refactor the parser',
  preview: 'refactor the parser please',
  started_at: NOW,
  last_active: NOW,
  message_count: 2,
  input_tokens: 1200,
  output_tokens: 300,
  total_tokens: 1500,
  cost_usd: null,
  is_active: false,
  ended_at: null,
  end_reason: null,
  tool_call_count: 0,
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
 * Catch-all stub for the dashboard-backed REST the app fires on load (model
 * picker, rail sessions list, status/config). Registered FIRST so the test's
 * later, more-specific `/sessions/sess-1*` routes take precedence (Playwright
 * runs handlers in reverse-registration order); everything else falls here. This
 * keeps the resume proof HERMETIC and console-clean whether or not the hermes
 * dashboard (:9123) is up — the run itself rides the real mock `/socket.io` flow.
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

test('Continue this session: seeds the prior transcript and resumes the run in-place', async ({
  page,
}) => {
  const errors = trackConsole(page)

  // The load-time dashboard REST is stubbed first; the test's specific session
  // routes (registered below) override it for `/sessions/sess-1*`.
  await stubDashboardRest(page)

  // Stub the session transcript REST; the run rides the real mock socket.
  await page.route('**/api/agent-deck/sessions/sess-1/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SESSION_MESSAGES),
    }),
  )
  // Stub the session DETAIL too — on Continue, App also loads it so the live
  // chat header carries the resumed session's title · model forward (T1.3).
  await page.route('**/api/agent-deck/sessions/sess-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SESSION_DETAIL),
    }),
  )

  // Land on the chat surface with the resume param (what "Continue" navigates to).
  await page.goto('/chat?continue=sess-1')

  // The prior transcript is preloaded into the live chat view.
  await expect(page.getByText('refactor the parser please')).toBeVisible()
  await expect(page.getByText('Sure, here is the plan.', { exact: true })).toBeVisible()

  // Continue carries the resumed session's identity into the live header (T1.3):
  // its title + model show in the shell top bar — not an empty, identity-less header.
  const header = page.getByTestId('chat-header')
  await expect(header).toContainText('Refactor the parser')
  await expect(header).toContainText('gpt-5.5')

  // Send a follow-up; it should resume the run inside the same session and stream.
  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await composer.click()
  await composer.fill('keep going')
  await page.getByTestId('composer-send').click()

  // The new user turn + the scripted streamed reply appear …
  await expect(page.getByText('keep going')).toBeVisible()
  await expect(page.getByText('Hello, from the mock agent.')).toBeVisible()

  // … and the prior transcript is STILL present (the run landed in-session, not
  // a fresh conversation).
  await expect(page.getByText('Sure, here is the plan.')).toBeVisible()

  expect(errors).toEqual([])
})

test('forking a HISTORICAL message of a resumed session does NOT reuse the original session_id; the copy says local / new-chat', async ({
  page,
}) => {
  const errors = trackConsole(page)
  await stubDashboardRest(page)
  await page.route('**/api/agent-deck/sessions/sess-1/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SESSION_MESSAGES),
    }),
  )
  await page.route('**/api/agent-deck/sessions/sess-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SESSION_DETAIL),
    }),
  )

  await page.goto('/chat?continue=sess-1')
  await expect(page.getByText('refactor the parser please')).toBeVisible()
  await expect(page.getByText('Sure, here is the plan.', { exact: true })).toBeVisible()

  // Fork from a HISTORICAL message (the first user turn, NOT the live head). Stock
  // Hermes cannot clone the ancestor path of a linear session — so the next send
  // must be a NEW chat, never a silent rewind of the existing session_id.
  await page.getByText('refactor the parser please').hover()
  await page.getByRole('button', { name: 'Fork from here' }).first().click()

  // The honest copy says the next message is a NEW chat, and the earlier turns are
  // reference-only — never a claim that Hermes saved/branched the session.
  const banner = page.getByTestId('fork-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(/forked locally/i)
  await expect(banner).toContainText(/new chat/i)
  await expect(banner).toContainText(/reference only/i)
  await expect(banner).not.toContainText(/persisted/i)

  // Capture the run command the socket emits so we can assert session_id is NOT
  // the original. The mock BFF echoes nothing back, so we observe the OUTBOUND
  // socket.io frame at the browser layer via a WebSocket frame sniffer.
  const runFrames: string[] = []
  page.on('websocket', (ws) => {
    ws.on('framesent', (data) => {
      const payload = typeof data.payload === 'string' ? data.payload : data.payload.toString()
      if (
        payload.includes('"input"') ||
        payload.includes('refactor') ||
        payload.includes('diverge')
      )
        runFrames.push(payload)
    })
  })

  // Send on the historical fork — a fresh run streams its reply.
  const composer = page.getByRole('textbox', { name: /message your agent/i })
  await composer.click()
  await composer.fill('diverge from history')
  await page.getByTestId('composer-send').click()
  await expect(page.getByText('diverge from history')).toBeVisible()
  await expect(page.getByText('Hello, from the mock agent.').first()).toBeVisible()

  // Stop the run so the test ends deterministically.
  const stop = page.getByTestId('composer-stop')
  if (await stop.isVisible()) await stop.click()
  await expect(page.getByTestId('composer-send')).toBeVisible()

  // Honesty guard: the emitted run command(s) for the fork send must NOT carry the
  // original session_id 'sess-1' (a historical fork is a new chat).
  const sentRun = runFrames.find((f) => f.includes('diverge from history'))
  if (sentRun) expect(sentRun).not.toContain('sess-1')

  expect(errors).toEqual([])
})
