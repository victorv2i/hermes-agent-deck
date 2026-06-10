import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AgentDeckStatus } from '@agent-deck/protocol'
import { ActiveRecentlyBand } from './ActiveRecentlyBand'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderBand(props: { enabled?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ActiveRecentlyBand enabled={props.enabled ?? true} />
    </QueryClientProvider>,
  )
}

function stubStatus(body: AgentDeckStatus) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body)),
  )
}

const BASE: AgentDeckStatus = {
  gatewayRunning: true,
  gatewayState: 'running',
  platforms: [
    { name: 'telegram', state: 'connected', error: null },
    { name: 'cron', state: 'connected', error: null },
  ],
  activeSessions: 2,
  version: '0.15.2',
  configUpdateAvailable: false,
}

describe('ActiveRecentlyBand', () => {
  it('shows a loading state while the status query is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    renderBand()
    expect(screen.getByTestId('active-recently-loading')).toBeInTheDocument()
  })

  it('renders per-platform dots, the session count, and honest "active recently" labeling when connected', async () => {
    stubStatus(BASE)
    renderBand()

    await waitFor(() => expect(screen.getByTestId('active-recently')).toBeInTheDocument())
    // Honest labeling — "active recently", never "live".
    const band = screen.getByTestId('active-recently')
    expect(within(band).getByText(/active recently/i)).toBeInTheDocument()
    expect(within(band).queryByText(/\blive\b/i)).not.toBeInTheDocument()

    // One dot per platform, each carrying its governed state (not amber).
    const tg = screen.getByTestId('platform-telegram')
    expect(within(tg).getByText('telegram')).toBeInTheDocument()
    expect(tg.getAttribute('data-state')).toBe('connected')
    expect(screen.getByTestId('platform-cron')).toBeInTheDocument()

    // Active-session count surfaced.
    expect(within(band).getByTestId('active-sessions')).toHaveTextContent('2')
  })

  it('surfaces a degraded platform with its reason', async () => {
    stubStatus({
      ...BASE,
      platforms: [
        { name: 'telegram', state: 'connected', error: null },
        { name: 'cron', state: 'degraded', error: 'token expired' },
      ],
    })
    renderBand()

    const cron = await screen.findByTestId('platform-cron')
    expect(cron.getAttribute('data-state')).toBe('degraded')
    expect(within(cron).getByText(/token expired/i)).toBeInTheDocument()
  })

  it('marks non-connected states with a distinguishing shape + label, not color alone', async () => {
    stubStatus({
      ...BASE,
      platforms: [
        { name: 'telegram', state: 'connected', error: null },
        { name: 'cron', state: 'degraded', error: 'token expired' },
        { name: 'cli', state: 'down', error: 'no socket' },
        { name: 'webhook', state: 'unknown', error: null },
      ],
    })
    renderBand()

    // Connected = the calm plain dot, no extra status marker icon.
    const tg = await screen.findByTestId('platform-telegram')
    expect(within(tg).queryByTestId('platform-state-marker')).not.toBeInTheDocument()

    // Each non-connected state carries a distinguishing marker (a SHAPE, not just
    // a hue) that is also labelled for assistive tech — so a colorblind / at-a-
    // glance operator can't conflate the warning hue with the live amber accent.
    for (const [name, label] of [
      ['cron', /degraded/i],
      ['cli', /down/i],
      ['webhook', /unknown/i],
    ] as const) {
      const chip = screen.getByTestId(`platform-${name}`)
      const marker = within(chip).getByTestId('platform-state-marker')
      expect(marker).toBeInTheDocument()
      expect(marker).toHaveAccessibleName(label)
    }
  })

  it('shows a gateway-down state when the gateway is not running', async () => {
    stubStatus({
      gatewayRunning: false,
      gatewayState: 'stopped',
      platforms: [],
      activeSessions: 0,
      version: '0.15.2',
      configUpdateAvailable: false,
    })
    renderBand()
    expect(await screen.findByTestId('active-recently-gateway-down')).toBeInTheDocument()
    expect(
      screen.getByText(/your agent isn’t running|your agent isn't running/i),
    ).toBeInTheDocument()
  })

  it('shows a gateway-down state when the status query fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"down"}', { status: 502 })),
    )
    renderBand()
    expect(await screen.findByTestId('active-recently-gateway-down')).toBeInTheDocument()
  })

  it('does not fetch and shows a paused placeholder when disabled', () => {
    const fetchSpy = vi.fn(async () => Response.json(BASE))
    vi.stubGlobal('fetch', fetchSpy)
    renderBand({ enabled: false })

    // The poll honors `enabled`: nothing is fetched while disabled.
    expect(fetchSpy).not.toHaveBeenCalled()
    // It must NOT claim "gateway not running" — it's simply paused, not probed.
    expect(screen.queryByTestId('active-recently-gateway-down')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-recently-paused')).toBeInTheDocument()
  })

  it('shows a config-update hint when configUpdateAvailable', async () => {
    stubStatus({ ...BASE, configUpdateAvailable: true })
    renderBand()
    expect(await screen.findByTestId('config-update-hint')).toBeInTheDocument()
  })

  it('does not show a config-update hint when versions are current', async () => {
    stubStatus(BASE)
    renderBand()
    await screen.findByTestId('active-recently')
    expect(screen.queryByTestId('config-update-hint')).not.toBeInTheDocument()
  })
})
