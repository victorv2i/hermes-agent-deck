import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { SystemRoute } from './SystemRoute'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const UP_TO_DATE = {
  gateway: { status: 'running' },
  hermes: { status: 'up-to-date', currentVersion: '0.15.1' },
  agentDeck: { status: 'no-channel', currentVersion: '0.1.0' },
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <SystemRoute />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('SystemRoute', () => {
  it('loads the dock read and renders the three cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(UP_TO_DATE)),
    )
    renderRoute()
    expect(screen.getByTestId('system-skeleton')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /your agent/i })).toBeInTheDocument(),
    )
    expect(screen.getByRole('region', { name: /hermes/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /agent[- ]deck/i })).toBeInTheDocument()
  })

  it('renders the error state (calm, no chat impact) when the read fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    )
    renderRoute()
    await waitFor(() =>
      expect(
        screen.getByText(/couldn't load system status|couldn't load system status/i),
      ).toBeInTheDocument(),
    )
  })

  it('POSTs the real gateway restart after the honest confirm, then re-reads', async () => {
    let restartCalls = 0
    let reads = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/system/gateway/restart')) {
        restartCalls += 1
        expect(init?.method).toBe('POST')
        return Response.json({ status: 'running' })
      }
      reads += 1
      return Response.json(UP_TO_DATE)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /your agent/i })).toBeInTheDocument(),
    )
    const readsBefore = reads
    const region = screen.getByRole('region', { name: /your agent/i })

    await user.click(within(region).getByRole('button', { name: /restart your agent/i }))
    // The confirm states the real cost; confirm it.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/disconnects for a few seconds/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^restart$/i }))

    await waitFor(() => expect(restartCalls).toBe(1))
    // The dock read is re-fetched so the card reflects the re-probed state.
    await waitFor(() => expect(reads).toBeGreaterThan(readsBefore))
  })

  it('only enables + POSTs the Hermes update when the read says update-available', async () => {
    let applyCalls = 0
    const available = {
      ...UP_TO_DATE,
      hermes: { status: 'update-available', currentVersion: '0.15.1' },
    }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/system/hermes/update')) {
        applyCalls += 1
        expect(init?.method).toBe('POST')
        return Response.json({
          status: 'up-to-date',
          log: ['Backed up.', 'Updated to v0.16.0.'],
          currentVersion: '0.16.0',
        })
      }
      return Response.json(available)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() => expect(screen.getByRole('region', { name: /hermes/i })).toBeInTheDocument())
    const region = screen.getByRole('region', { name: /hermes/i })
    const apply = within(region).getByRole('button', { name: /update hermes/i })
    expect(apply).toBeEnabled()

    await user.click(apply)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^update$/i }))

    await waitFor(() => expect(applyCalls).toBe(1))
  })

  it('SCRUBS nothing extra and never echoes a token from the apply result log', async () => {
    const available = {
      ...UP_TO_DATE,
      hermes: { status: 'update-available', currentVersion: '0.15.1' },
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/system/hermes/update')) {
        return Response.json({
          status: 'up-to-date',
          log: ['Backed up.', 'Updated to v0.16.0.'],
          currentVersion: '0.16.0',
        })
      }
      return Response.json(available)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() => expect(screen.getByRole('region', { name: /hermes/i })).toBeInTheDocument())
    const region = screen.getByRole('region', { name: /hermes/i })
    await user.click(within(region).getByRole('button', { name: /update hermes/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^update$/i }))

    // The result log appears; opening it shows the (already-scrubbed) lines verbatim.
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: /hermes/i })).getByRole('button', {
          name: /log/i,
        }),
      ).toBeInTheDocument(),
    )
    await user.click(
      within(screen.getByRole('region', { name: /hermes/i })).getByRole('button', { name: /log/i }),
    )
    expect(screen.getByText(/Updated to v0\.16\.0/)).toBeInTheDocument()
  })
})
