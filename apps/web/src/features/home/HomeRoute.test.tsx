import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import type { ChatOutletContext } from '@/app/navigation'
import { HomeRoute } from './HomeRoute'
import { ONBOARDED_KEY, resetOnboarded, getOnboardedSnapshot } from '@/lib/useOnboarded'
import type { SessionListResponse } from '@/features/sessions/types'

/**
 * Connected Home test: a stubbed BFF (mocked global fetch) feeding the real
 * HomeRoute through a real QueryClient + MemoryRouter. Verifies it loads recent
 * sessions, marks the user onboarded on a first action while navigating, and
 * degrades calmly when the dashboard `/status` is down (no error wall).
 */

const NOW_SEC = Math.floor(Date.now() / 1000)

function sessionRow(id: string, title: string) {
  return {
    id,
    source: 'web',
    model: 'anthropic/claude-sonnet-4',
    title,
    preview: 'preview',
    started_at: NOW_SEC,
    last_active: NOW_SEC,
    message_count: 2,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    cost_usd: null,
    is_active: false,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const LIST: SessionListResponse = {
  total: 2,
  sessions: [sessionRow('sess-a', 'Launch plan'), sessionRow('sess-b', 'Bug triage')],
}

const STATUS_BODY = {
  gatewayRunning: true,
  gatewayState: 'running',
  platforms: [{ name: 'telegram', state: 'connected', error: null }],
  activeSessions: 1,
  version: '0.15.2',
  configUpdateAvailable: false,
}

const HEALTH_BODY = {
  status: 'ok',
  hermes: { reachable: true, endpoint: 'http://127.0.0.1:8643', platform: 'hermes-agent' },
  bind: { remote: false, terminalEnabled: true, authRequired: false },
  version: '0.1.0',
}

const USAGE_BODY = {
  periodDays: 7,
  totals: {
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    estimatedCost: 0.05,
    actualCost: 0.05,
    sessions: 3,
  },
  daily: [],
  byModel: [],
}

const PROFILES_BODY = {
  active: 'default',
  profiles: [
    {
      name: 'default',
      path: '/p/default',
      isDefault: true,
      isActive: true,
      model: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
      hasEnv: false,
      skillCount: 3,
      gatewayRunning: true,
      avatar: null,
      displayName: null,
    },
  ],
}

/** Two scheduled cron jobs — feeds the "watching N schedules" tending fact. */
const JOBS_BODY = {
  jobs: [
    {
      id: 'j1',
      name: 'Morning brief',
      prompt: 'Summarize the news',
      schedule: {
        kind: 'cron',
        display: '0 9 * * *',
        expr: '0 9 * * *',
        minutes: null,
        runAt: null,
      },
      enabled: true,
      paused: false,
      profile: 'default',
      deliver: 'local',
      noAgent: false,
      createdAt: null,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      runCount: 0,
      repeatTimes: null,
    },
    {
      id: 'j2',
      name: 'Evening digest',
      prompt: 'Summarize the day',
      schedule: {
        kind: 'cron',
        display: '0 18 * * *',
        expr: '0 18 * * *',
        minutes: null,
        runAt: null,
      },
      enabled: true,
      paused: false,
      profile: 'default',
      deliver: 'local',
      noAgent: false,
      createdAt: null,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      runCount: 0,
      repeatTimes: null,
    },
  ],
}

/** The kanban plugin is absent on this fake Hermes (honest unavailable). */
const KANBAN_BODY = { available: false }

/** Whether `/status` should fail (simulate the dashboard being down/401). */
let statusFails = false
/** Whether `/status` reports the Hermes gateway process as running. */
let statusGatewayRunning = true
/** Whether `/health` says the Hermes gateway is reachable. */
let healthReachable = true
/** Whether the `/health` REQUEST itself fails (the deck's own server is down). */
let healthFails = false
/** Whether `/sessions` should fail (simulate a recents read failure). */
let sessionsFails = false

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/status')) {
        if (statusFails) return jsonResponse({ error: 'unauthorized' }, 401)
        return jsonResponse({
          ...STATUS_BODY,
          gatewayRunning: statusGatewayRunning,
          gatewayState: statusGatewayRunning ? 'running' : 'stopped',
        })
      }
      if (url.includes('/health')) {
        if (healthFails) return jsonResponse({ error: 'unavailable' }, 503)
        return jsonResponse({
          ...HEALTH_BODY,
          status: healthReachable ? 'ok' : 'degraded',
          hermes: {
            ...HEALTH_BODY.hermes,
            reachable: healthReachable,
            platform: healthReachable ? HEALTH_BODY.hermes.platform : null,
          },
        })
      }
      if (url.includes('/usage')) return jsonResponse(USAGE_BODY)
      if (url.includes('/profiles')) return jsonResponse(PROFILES_BODY)
      if (url.includes('/cron/jobs')) return jsonResponse(JOBS_BODY)
      if (url.includes('/kanban/board')) return jsonResponse(KANBAN_BODY)
      if (url.includes('/sessions')) {
        if (sessionsFails) return jsonResponse({ error: 'unavailable' }, 503)
        return jsonResponse(LIST)
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

/** Surfaces the current path so navigation side-effects are assertable. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // HomeRoute reads the App-owned actions off the Outlet context (the real App
  // layout provides them); a stub layout supplies the same contract here, with
  // a spied openPalette so the hero's ⌘K chip wiring is assertable.
  const openPalette = vi.fn()
  const outletContext: ChatOutletContext = {
    send: () => {},
    stop: () => {},
    respondApproval: () => {},
    retry: () => {},
    editTurn: () => {},
    connection: 'connected',
    newChat: () => {},
    clearChat: () => {},
    openPalette,
  }
  function StubLayout() {
    return <Outlet context={outletContext} />
  }
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
        <Routes>
          <Route element={<StubLayout />}>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/chat" element={<div>chat surface</div>} />
            <Route path="/usage" element={<div>usage surface</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, client, openPalette }
}

beforeEach(() => {
  statusFails = false
  statusGatewayRunning = true
  healthReachable = true
  healthFails = false
  sessionsFails = false
  localStorage.clear()
  resetOnboarded()
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  resetOnboarded()
})

describe('HomeRoute (connected)', () => {
  it('loads recent sessions from the BFF into Jump back in', async () => {
    renderHome()
    expect(await screen.findByText('Launch plan')).toBeInTheDocument()
    expect(screen.getByText('Bug triage')).toBeInTheDocument()
  })

  it('does not show starter prompts when the sessions query failed', async () => {
    sessionsFails = true
    renderHome()
    expect(await screen.findByText(/couldn't load recent chats/i)).toBeInTheDocument()
    expect(screen.queryByText(/that's an approval/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /summarize my morning/i })).not.toBeInTheDocument()
  })

  it('marks onboarded and navigates to chat (with a continue id) on resume', async () => {
    renderHome()
    const card = await screen.findByText('Launch plan')
    await userEvent.click(card)
    expect(getOnboardedSnapshot()).toBe(true)
    expect(localStorage.getItem(ONBOARDED_KEY)).toBe('1')
    expect(screen.getByTestId('location').textContent).toBe('/chat?continue=sess-a')
  })

  it("the hero ⌘K chip drives the Outlet context's App-owned openPalette action", async () => {
    const { openPalette } = renderHome()
    const chip = await screen.findByRole('button', { name: /open the command palette/i })
    await userEvent.click(chip)
    expect(openPalette).toHaveBeenCalledTimes(1)
    // Opening the palette is not a navigation: Home stays the surface.
    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('marks onboarded and navigates to chat on Start a chat', async () => {
    renderHome()
    const cta = await screen.findByRole('button', { name: /start a chat/i })
    await userEvent.click(cta)
    expect(getOnboardedSnapshot()).toBe(true)
    expect(screen.getByTestId('location').textContent).toBe('/chat')
  })

  it('marks onboarded and navigates to Usage from the status-band usage line', async () => {
    renderHome()
    // The status band's usage snapshot is now a real affordance → /usage.
    const strip = await screen.findByRole('region', { name: /status/i })
    const usageLink = await within(strip).findByRole('button', { name: /tokens/i })
    await userEvent.click(usageLink)
    expect(getOnboardedSnapshot()).toBe(true)
    expect(screen.getByTestId('location').textContent).toBe('/usage')
  })

  it('degrades calmly when the dashboard /status is down and health is unreachable (no error wall)', async () => {
    statusFails = true
    healthReachable = false
    renderHome()
    // Sessions + usage still load; the status strip shows a calm offline line.
    expect(await screen.findByText('Launch plan')).toBeInTheDocument()
    const strip = screen.getByRole('region', { name: /status/i })
    await waitFor(() => {
      expect(within(strip).getByText(/doesn't affect chatting/i)).toBeInTheDocument()
    })
    // No error boundary / error wall replaced the page.
    expect(screen.getByRole('button', { name: /start a chat/i })).toBeInTheDocument()
  })

  it('composes the "what your agent is tending" strip from existing hooks', async () => {
    renderHome()
    const strip = await screen.findByRole('region', { name: /what .* tending/i })
    // Connected headline (gateway running) + the two scheduled cron jobs.
    expect(within(strip).getByText(/connected/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(within(strip).getByText(/watching 2 schedules/i)).toBeInTheDocument()
    })
    // 1 active session (from STATUS_BODY) is reported plainly.
    expect(within(strip).getByText(/1 active session/i)).toBeInTheDocument()
  })

  it('shows an honest offline tending strip when /status is down and health is unreachable', async () => {
    statusFails = true
    healthReachable = false
    renderHome()
    const strip = await screen.findByRole('region', { name: /what .* tending/i })
    await waitFor(() => {
      expect(within(strip).getByText(/offline/i)).toBeInTheDocument()
    })
  })

  it('offers the Start my agent recovery on the offline headline when /health reports the agent down', async () => {
    // The deck's own server answered the probe (BFF up) and reported the agent
    // unreachable: the restart POST can land, so the one-click action is offered.
    statusFails = true
    healthReachable = false
    renderHome()
    const strip = await screen.findByRole('region', { name: /what .* tending/i })
    await waitFor(() => {
      expect(within(strip).getByText(/offline/i)).toBeInTheDocument()
    })
    expect(
      await within(strip).findByRole('button', { name: /start my agent/i }),
    ).toBeInTheDocument()
  })

  it('offers Start my agent when /status itself reports the gateway not running', async () => {
    // /status resolving proves the deck server is up; gatewayRunning:false is its
    // honest report that the agent is down. The headline + action pair up.
    statusGatewayRunning = false
    renderHome()
    const strip = await screen.findByRole('region', { name: /what .* tending/i })
    await waitFor(() => {
      expect(within(strip).getByText(/hermes is not running/i)).toBeInTheDocument()
    })
    expect(
      await within(strip).findByRole('button', { name: /start my agent/i }),
    ).toBeInTheDocument()
  })

  it('NO Start action when the deck server itself is down (/health fails): the call could not land', async () => {
    statusFails = true
    healthFails = true
    renderHome()
    const strip = await screen.findByRole('region', { name: /what .* tending/i })
    await waitFor(() => {
      expect(within(strip).getByText(/offline/i)).toBeInTheDocument()
    })
    expect(within(strip).queryByRole('button', { name: /start my agent/i })).toBeNull()
  })

  it('no Start action while connected (the recovery rides ONLY the down headline)', async () => {
    renderHome()
    const strip = await screen.findByRole('region', { name: /what .* tending/i })
    await waitFor(() => {
      expect(within(strip).getByText(/^Connected$/i)).toBeInTheDocument()
    })
    expect(within(strip).queryByRole('button', { name: /start my agent/i })).toBeNull()
  })

  it('uses reachable health as the Home fallback when detailed /status is unavailable', async () => {
    statusFails = true
    healthReachable = true
    renderHome()

    const statusStrip = await screen.findByRole('region', { name: /status/i })
    await waitFor(() => {
      expect(within(statusStrip).getAllByText(/^available$/i).length).toBeGreaterThan(0)
    })
    expect(within(statusStrip).queryByText(/^offline$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/live status is offline/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Hermes is reachable/i)).toBeInTheDocument()

    const tendingStrip = await screen.findByRole('region', { name: /what .* tending/i })
    await waitFor(() => {
      expect(within(tendingStrip).getByText(/^Connected$/i)).toBeInTheDocument()
    })
    expect(within(tendingStrip).queryByText(/offline/i)).not.toBeInTheDocument()
    expect(within(tendingStrip).queryByText(/all quiet/i)).not.toBeInTheDocument()
    // Health only proves reachability; the detailed status facts stay absent.
    expect(within(tendingStrip).queryByText(/active session/i)).not.toBeInTheDocument()
  })

  it('does not keep stale detailed status after a successful status query later fails', async () => {
    const { client } = renderHome()
    const statusStrip = await screen.findByRole('region', { name: /status/i })

    await waitFor(() => {
      expect(within(statusStrip).getByText('v0.15.2')).toBeInTheDocument()
    })
    const tendingStrip = await screen.findByRole('region', { name: /what .* tending/i })
    expect(within(tendingStrip).getByText(/1 active session/i)).toBeInTheDocument()

    statusFails = true
    healthReachable = false
    await Promise.all([
      client.invalidateQueries({ queryKey: ['agent-deck', 'status'] }),
      client.invalidateQueries({ queryKey: ['agent-deck', 'home', 'health'] }),
    ])

    await waitFor(() => {
      expect(within(statusStrip).getByText(/doesn't affect chatting/i)).toBeInTheDocument()
    })
    expect(within(statusStrip).queryByText('v0.15.2')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(within(tendingStrip).getByText(/offline/i)).toBeInTheDocument()
    })
    expect(within(tendingStrip).queryByText(/active session/i)).not.toBeInTheDocument()
  })
})
