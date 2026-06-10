import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { McpRoute } from './McpRoute'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const STATE = {
  servers: [
    {
      name: 'context7',
      transport: 'http',
      transportDetail: 'https://mcp.context7.com/mcp',
      authKind: 'oauth',
      enabled: true,
      toolCount: null,
    },
  ],
  catalog: [
    {
      name: 'linear',
      description: 'Linear issues.',
      transport: 'http',
      authKind: 'oauth',
      sourceUrl: null,
      requiresInstall: false,
      installed: false,
    },
  ],
}

const MUTATION_RESULT = { state: STATE, restartRequired: true }

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <McpRoute />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('McpRoute', () => {
  it('loads the MCP read and renders a card per configured server + the catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(STATE)),
    )
    renderRoute()
    expect(screen.getByTestId('mcp-skeleton')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Integrations (MCP)' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /context7/i })).toBeInTheDocument(),
    )
    expect(screen.getByText('hermes mcp install linear')).toBeInTheDocument()
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

  it('PATCHes the toggle to the :name route and re-reads', async () => {
    let patchCalls = 0
    let sentBody: unknown
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && /\/mcp\/context7$/.test(url) && init?.method === 'PATCH') {
        patchCalls += 1
        sentBody = JSON.parse(String(init?.body))
        return Response.json(MUTATION_RESULT)
      }
      return Response.json(STATE)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /context7/i })).toBeInTheDocument(),
    )
    const region = screen.getByRole('region', { name: /context7/i })
    await user.click(within(region).getByRole('button', { name: /^disable$/i }))
    await waitFor(() => expect(patchCalls).toBe(1))
    expect(sentBody).toEqual({ enabled: false })
  })

  it('POSTs the probe to the :name/test route and shows discovered tools', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && /\/mcp\/context7\/test$/.test(url)) {
        expect(init?.method).toBe('POST')
        return Response.json({
          name: 'context7',
          ok: true,
          tools: [{ name: 'resolve-library-id', description: 'Resolves a name' }],
          error: null,
          authCaveat: null,
        })
      }
      return Response.json(STATE)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /context7/i })).toBeInTheDocument(),
    )
    const region = screen.getByRole('region', { name: /context7/i })
    await user.click(within(region).getByRole('button', { name: /test tools/i }))
    await waitFor(() => expect(screen.getByText('resolve-library-id')).toBeInTheDocument())
  })

  it('removes a server through the themed confirm dialog (no raw window.confirm), then DELETEs', async () => {
    // The destructive remove must route through the app's themed dialog — never a
    // raw browser confirm (which can't be themed, trapped, or screen-reader-tuned).
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    let deleteCalls = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && /\/mcp\/context7$/.test(url) && init?.method === 'DELETE') {
        deleteCalls += 1
        return Response.json(MUTATION_RESULT)
      }
      return Response.json(STATE)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /context7/i })).toBeInTheDocument(),
    )
    const region = screen.getByRole('region', { name: /context7/i })
    await user.click(within(region).getByRole('button', { name: /remove context7/i }))

    // A themed dialog opens — the browser's window.confirm is never called.
    const dialog = await screen.findByRole('dialog')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deleteCalls).toBe(0)

    // Confirming in the dialog fires the real DELETE.
    await user.click(within(dialog).getByRole('button', { name: /^remove$/i }))
    await waitFor(() => expect(deleteCalls).toBe(1))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('cancelling the remove dialog does NOT DELETE', async () => {
    let deleteCalls = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && /\/mcp\/context7$/.test(url) && init?.method === 'DELETE') {
        deleteCalls += 1
        return Response.json(MUTATION_RESULT)
      }
      return Response.json(STATE)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderRoute()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /context7/i })).toBeInTheDocument(),
    )
    const region = screen.getByRole('region', { name: /context7/i })
    await user.click(within(region).getByRole('button', { name: /remove context7/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    expect(deleteCalls).toBe(0)
  })

  it('restart fires the REAL gateway restart, then re-reads MCP', async () => {
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
      expect(screen.getByRole('region', { name: /context7/i })).toBeInTheDocument(),
    )
    const readsBefore = reads
    await user.click(screen.getByRole('button', { name: /restart your agent/i }))
    await waitFor(() => expect(restartCalls).toBe(1))
    await waitFor(() => expect(reads).toBeGreaterThan(readsBefore))
  })
})
