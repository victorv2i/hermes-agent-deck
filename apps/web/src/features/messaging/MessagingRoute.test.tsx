import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { MessagingRoute } from './MessagingRoute'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const STATE = {
  gatewayRunning: true,
  platforms: [
    {
      platform: {
        id: 'telegram',
        label: 'Telegram',
        setupUrl: 'https://t.me/BotFather',
        steps: ['Message @BotFather'],
      },
      connection: 'not_configured',
      errorMessage: null,
      tokens: [
        { envVar: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', isSet: false, redactedValue: null },
      ],
    },
  ],
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // MemoryRouter: DmAuthPanel links to the Connections > Pairing tab.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <MessagingRoute />
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('MessagingRoute', () => {
  it('loads the messaging read and renders a card per platform', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(STATE)),
    )
    renderRoute()
    expect(screen.getByTestId('messaging-skeleton')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /telegram/i })).toBeInTheDocument(),
    )
  })

  it('renders the calm error state when the read fails (no chat impact)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    )
    renderRoute()
    await waitFor(() =>
      expect(screen.getByText(/couldn’t load|couldn't load/i)).toBeInTheDocument(),
    )
  })

  it('POSTs the typed token to the messaging/token route (shape-only response)', async () => {
    let tokenCalls = 0
    let sentBody: unknown
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/messaging/token')) {
        tokenCalls += 1
        expect(init?.method).toBe('POST')
        sentBody = JSON.parse(String(init?.body))
        return Response.json({
          platform: 'telegram',
          tokens: [
            {
              envVar: 'TELEGRAM_BOT_TOKEN',
              label: 'Bot token',
              isSet: true,
              redactedValue: 'sec…123',
            },
          ],
          restartRequired: true,
        })
      }
      return Response.json(STATE)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /telegram/i })).toBeInTheDocument(),
    )
    const region = screen.getByRole('region', { name: /telegram/i })
    // The compact tile is collapsed by default — expand it to reach the token field.
    await user.click(within(region).getByRole('button', { name: /telegram/i }))
    await user.type(within(region).getByLabelText(/bot token/i), 'my-secret-token')
    await user.click(within(region).getByRole('button', { name: /save token/i }))

    await waitFor(() => expect(tokenCalls).toBe(1))
    expect(sentBody).toEqual({
      platform: 'telegram',
      envVar: 'TELEGRAM_BOT_TOKEN',
      value: 'my-secret-token',
    })
  })

  it('restart-to-apply fires the real gateway restart, then re-reads messaging', async () => {
    let restartCalls = 0
    let reads = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/system/gateway/restart')) {
        restartCalls += 1
        expect(init?.method).toBe('POST')
        return Response.json({ status: 'running' })
      }
      reads += 1
      return Response.json(STATE)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /telegram/i })).toBeInTheDocument(),
    )
    const readsBefore = reads
    const region = screen.getByRole('region', { name: /telegram/i })
    // Expand the compact tile to reach the "Restart to apply" action.
    await user.click(within(region).getByRole('button', { name: /telegram/i }))
    await user.click(within(region).getByRole('button', { name: /restart to apply/i }))

    await waitFor(() => expect(restartCalls).toBe(1))
    // The messaging read is re-fetched so connection states re-resolve.
    await waitFor(() => expect(reads).toBeGreaterThan(readsBefore))
  })
})
