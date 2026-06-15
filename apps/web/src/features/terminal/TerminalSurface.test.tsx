import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect, type ComponentType } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { TerminalSurface } from './TerminalSurface'
import { TERMINAL_ACK_KEY, type AckStorage } from './useTerminalAcknowledged'
import { TERMINAL_SESSIONS_KEY } from './terminalSessions'
import type { TerminalViewProps } from './TerminalView'

/**
 * The unified Terminal surface route. These tests mount it behind a memory router
 * that resolves the SAME three paths the real app does (/terminal, /workspaces,
 * /workspaces/:id) so the switcher's navigation + the :id deep link are exercised
 * for real. They consolidate the route-level coverage from the old TerminalRoute
 * (probe gates, the consent gate, the launcher, the header Clear/Restart, resume)
 * and add the new switcher, Save-promote, and routing/deep-link coverage.
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

const CLIS_OK = {
  clis: [
    { id: 'hermes', label: 'Hermes CLI', available: true },
    { id: 'claude', label: 'Claude Code', available: false, installUrl: 'https://x/claude' },
    { id: 'codex', label: 'Codex', available: true },
    { id: 'shell', label: 'Raw shell', available: true },
  ],
}

/** A fetch answering the status probe, the `/clis` list, the tmux `/sessions`
 * list, AND the workspaces list (empty unless overridden). */
function deckFetch(
  opts: {
    status?: unknown
    clis?: unknown
    tmux?: unknown
    workspaces?: unknown
    workspace?: (id: string) => unknown
    onCreate?: (body: unknown) => unknown
  } = {},
) {
  const {
    status = { available: true },
    clis = CLIS_OK,
    tmux = { tmuxAvailable: false, sessions: [] },
    workspaces = { workspaces: [] },
    workspace,
    onCreate,
  } = opts
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string') {
      if (init?.method === 'POST' && url.includes('/terminal/workspaces')) {
        const body = init.body ? JSON.parse(init.body as string) : {}
        return jsonResponse(onCreate ? onCreate(body) : { id: 'new-ws-1', name: body.name, panes: body.panes ?? [], createdAt: 'x', lastModifiedAt: 'x' })
      }
      const wsMatch = url.match(/\/terminal\/workspaces\/([^/?]+)/)
      if (wsMatch && (!init || init.method === undefined || init.method === 'GET')) {
        return jsonResponse(workspace ? workspace(decodeURIComponent(wsMatch[1]!)) : { id: wsMatch[1], name: 'WS', panes: [], createdAt: 'x', lastModifiedAt: 'x' })
      }
      if (url.includes('/terminal/workspaces')) return jsonResponse(workspaces)
      if (url.includes('/clis')) return jsonResponse(clis)
      if (url.includes('/sessions')) return jsonResponse(tmux)
    }
    return jsonResponse(status)
  }) as unknown as typeof fetch
}

function ackedStorage(): AckStorage {
  const map = new Map<string, string>([[TERMINAL_ACK_KEY, '1']])
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}
function freshStorage(): AckStorage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

function StubView() {
  return <div data-testid="terminal-view">live terminal</div>
}

let stubMounts = 0
const stubClear = vi.fn()
function WiringStubView({ onStatusChange, onClearReady }: TerminalViewProps) {
  useEffect(() => {
    stubMounts += 1
    onStatusChange?.('connected')
    onClearReady?.(stubClear)
    return () => onClearReady?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div data-testid="terminal-view">live terminal</div>
}

/** Render the surface at `initial` behind the real three-path router. */
function renderAt(
  initial: string,
  props: { fetchImpl?: typeof fetch; viewComponent?: ComponentType<TerminalViewProps>; ackStorage?: AckStorage } = {},
) {
  const element = <TerminalSurface {...props} />
  const routes: RouteObject[] = [
    { path: '/terminal', element },
    { path: '/workspaces', element },
    { path: '/workspaces/:id', element },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [initial] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, router }
}

async function launchRawShell() {
  const launch = await screen.findByRole('button', { name: /launch the raw shell/i })
  fireEvent.click(launch)
}

describe('TerminalSurface: Scratch (the quick terminal)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('mounts the terminal after the user picks a launcher preset (already acknowledged)', async () => {
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: StubView, ackStorage: ackedStorage() })
    await launchRawShell()
    expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
    expect(screen.getByText('A real shell on the host')).toBeInTheDocument()
  })

  it('shows the launcher (only installed CLIs actionable) before any session', async () => {
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: StubView, ackStorage: ackedStorage() })
    expect(await screen.findByRole('button', { name: /launch the hermes cli/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /launch the claude code/i })).toBeNull()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('forwards the chosen preset id to the view as `cli`', async () => {
    const seenCli: string[] = []
    function CapturingView({ cli }: TerminalViewProps) {
      useEffect(() => {
        seenCli.push(cli ?? '<none>')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid="terminal-view">live</div>
    }
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: CapturingView, ackStorage: ackedStorage() })
    fireEvent.click(await screen.findByRole('button', { name: /launch the hermes cli/i }))
    await screen.findByTestId('terminal-view')
    expect(seenCli).toContain('hermes')
  })

  it('shows an honest unavailable panel with the backend reason', async () => {
    const fetchImpl = deckFetch({
      status: { available: false, cwd_available: false, reason: 'node-pty is not available on this host.' },
    })
    renderAt('/terminal', { fetchImpl, viewComponent: StubView })
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/not available on this host/i)).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('shows the calm no-workspace panel BEFORE the consent gate when cwd_available is false', async () => {
    const fetchImpl = deckFetch({
      status: { available: true, cwd_available: false, reason: 'No workspace directory to open the terminal in.' },
    })
    renderAt('/terminal', { fetchImpl, viewComponent: StubView, ackStorage: freshStorage() })
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/no workspace directory/i)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: /real shell warning/i })).not.toBeInTheDocument()
  })

  it('shows a reachability error when the status probe fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, false, 500)) as unknown as typeof fetch
    renderAt('/terminal', { fetchImpl, viewComponent: StubView })
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/couldn't reach the terminal backend/i)).toBeInTheDocument()
  })

  it('renders the surface header', async () => {
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: StubView, ackStorage: ackedStorage() })
    expect(await screen.findByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
  })

  it('renders exactly ONE header for the surface (no double header)', async () => {
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: StubView, ackStorage: ackedStorage() })
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    expect(screen.getAllByRole('heading', { name: 'Terminal' })).toHaveLength(1)
  })

  it('folds the live connection status into the header actions', async () => {
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: WiringStubView, ackStorage: ackedStorage() })
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    expect(await screen.findByText('Connected')).toBeInTheDocument()
  })

  it('Clear button in the header invokes the engine clear handle', async () => {
    stubClear.mockClear()
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: WiringStubView, ackStorage: ackedStorage() })
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    const clear = await screen.findByRole('button', { name: /clear/i })
    await waitFor(() => expect(clear).not.toBeDisabled())
    fireEvent.click(clear)
    expect(stubClear).toHaveBeenCalledTimes(1)
  })

  it('Restart button remounts the view for an in-place reconnect', async () => {
    stubMounts = 0
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: WiringStubView, ackStorage: ackedStorage() })
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    expect(stubMounts).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    await waitFor(() => expect(stubMounts).toBe(2))
  })

  it('resumes the persisted sessions on reload (mounts the grid, not the launcher)', async () => {
    localStorage.setItem(
      TERMINAL_SESSIONS_KEY,
      JSON.stringify({
        sessions: [{ id: 'term-1-abc123', cli: 'shell', title: 'Shell 1', epoch: 0 }],
        activeId: 'term-1-abc123',
        viewMode: 'tab',
        seq: 1,
      }),
    )
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: StubView, ackStorage: ackedStorage() })
    expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /launch the raw shell/i })).toBeNull()
  })

  describe('first-open real-shell acknowledge gate', () => {
    it('shows the real-shell warning and does NOT mount the view until acknowledged', async () => {
      renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: WiringStubView, ackStorage: freshStorage() })
      const gate = await screen.findByRole('alertdialog', { name: /real shell warning/i })
      expect(within(gate).getByText(/a quick heads-up first/i)).toBeInTheDocument()
      expect(within(gate).getByText(/there's no sandbox/i)).toBeInTheDocument()
      expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
    })

    it('shows the launcher after the user acknowledges (then mounts on select)', async () => {
      renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: StubView, ackStorage: freshStorage() })
      const ack = await screen.findByRole('button', { name: /open the terminal/i })
      fireEvent.click(ack)
      await launchRawShell()
      expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog', { name: /real shell warning/i })).not.toBeInTheDocument()
    })
  })

  describe('tmux persistence wiring (launcher)', () => {
    it('the launcher says when shells cannot persist (no tmux on the host)', async () => {
      renderAt('/terminal', {
        fetchImpl: deckFetch({ tmux: { tmuxAvailable: false, sessions: [] } }),
        viewComponent: StubView,
        ackStorage: ackedStorage(),
      })
      expect(
        await screen.findByText('Shells on this host are not persistent (tmux not installed).'),
      ).toBeInTheDocument()
    })

    it('recovers running deck shells from the launcher after browser data loss', async () => {
      renderAt('/terminal', {
        fetchImpl: deckFetch({
          tmux: {
            tmuxAvailable: true,
            sessions: [
              { name: 'adk_lost-1', deckOwned: true, attachedCount: 0, createdEpoch: 1765000000, lastActivityEpoch: 1765000100, persistent: true },
            ],
          },
        }),
        viewComponent: StubView,
        ackStorage: ackedStorage(),
      })
      fireEvent.click(await screen.findByRole('button', { name: /reattach/i }))
      expect(await screen.findByRole('tab', { name: /lost-1/i })).toBeInTheDocument()
    })
  })
})

describe('TerminalSurface: the workspace switcher + routing', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const TWO_WORKSPACES = {
    workspaces: [
      { id: 'ws-a', name: 'Alpha', paneCount: 2, createdAt: 'x', lastModifiedAt: 'x' },
      { id: 'ws-b', name: 'Beta', paneCount: 1, createdAt: 'x', lastModifiedAt: 'x' },
    ],
  }

  it('lists Scratch pinned first, then the saved workspaces', async () => {
    renderAt('/terminal', {
      fetchImpl: deckFetch({ workspaces: TWO_WORKSPACES }),
      viewComponent: StubView,
      ackStorage: ackedStorage(),
    })
    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    const pills = within(switcher).getAllByRole('tab')
    expect(pills.map((p) => p.textContent)).toEqual(['Scratch', 'Alpha', 'Beta'])
    // Scratch is selected by default on /terminal.
    expect(pills[0]!).toHaveAttribute('aria-selected', 'true')
  })

  it('selecting a saved workspace navigates to /workspaces/:id and shows its panes', async () => {
    const { router } = renderAt('/terminal', {
      fetchImpl: deckFetch({
        workspaces: TWO_WORKSPACES,
        workspace: (id) => ({
          id,
          name: 'Alpha',
          panes: [{ id: 'p1', label: 'Build', cli: 'shell' }],
          createdAt: 'x',
          lastModifiedAt: 'x',
        }),
      }),
      viewComponent: StubView,
      ackStorage: ackedStorage(),
    })
    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    fireEvent.click(within(switcher).getByRole('tab', { name: 'Alpha' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces/ws-a'))
    // The workspace's pane renders (its tab is present).
    expect(await screen.findByRole('tab', { name: /build/i })).toBeInTheDocument()
  })

  it('deep link /workspaces/:id selects that workspace by id (cross-device)', async () => {
    renderAt('/workspaces/ws-b', {
      fetchImpl: deckFetch({
        workspaces: TWO_WORKSPACES,
        workspace: (id) => ({
          id,
          name: 'Beta',
          panes: [{ id: 'pz', label: 'Server', cli: 'shell' }],
          createdAt: 'x',
          lastModifiedAt: 'x',
        }),
      }),
      viewComponent: StubView,
      ackStorage: ackedStorage(),
    })
    // The Beta pill is selected (not Scratch), and Beta's pane renders.
    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    await waitFor(() =>
      expect(within(switcher).getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true'),
    )
    expect(await screen.findByRole('tab', { name: /server/i })).toBeInTheDocument()
  })

  it('/workspaces (no id) resolves to the unified surface with Scratch active', async () => {
    renderAt('/workspaces', {
      fetchImpl: deckFetch({ workspaces: TWO_WORKSPACES }),
      viewComponent: StubView,
      ackStorage: ackedStorage(),
    })
    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    expect(within(switcher).getByRole('tab', { name: 'Scratch' })).toHaveAttribute('aria-selected', 'true')
    // Scratch shows its launcher (no live session yet).
    expect(await screen.findByRole('button', { name: /launch the raw shell/i })).toBeInTheDocument()
  })

  it('clicking Scratch from a workspace returns to /terminal', async () => {
    const { router } = renderAt('/workspaces/ws-a', {
      fetchImpl: deckFetch({
        workspaces: TWO_WORKSPACES,
        workspace: (id) => ({ id, name: 'Alpha', panes: [], createdAt: 'x', lastModifiedAt: 'x' }),
      }),
      viewComponent: StubView,
      ackStorage: ackedStorage(),
    })
    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    fireEvent.click(within(switcher).getByRole('tab', { name: 'Scratch' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/terminal'))
  })
})

describe('TerminalSurface: Save-promote', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('Save posts a workspace built from the current Scratch panes, then switches to it', async () => {
    // A prior Scratch session is parked, so the grid mounts straight away with one
    // pane (no launcher click needed) and the Save action is available.
    localStorage.setItem(
      TERMINAL_SESSIONS_KEY,
      JSON.stringify({
        sessions: [{ id: 'term-1-abc123', cli: 'hermes', title: 'Hermes 1', epoch: 0 }],
        activeId: 'term-1-abc123',
        viewMode: 'tab',
        seq: 1,
      }),
    )
    let posted: { name?: string; panes?: Array<{ cli?: string; label?: string }> } | null = null
    const fetchImpl = deckFetch({
      onCreate: (body) => {
        posted = body as typeof posted
        return { id: 'saved-1', name: (body as { name: string }).name, panes: (body as { panes: unknown[] }).panes, createdAt: 'x', lastModifiedAt: 'x' }
      },
      // After the save, the surface fetches the new workspace definition.
      workspace: (id) => ({
        id,
        name: 'My set',
        panes: [{ id: 'term-1-abc123', label: 'Hermes 1', cli: 'hermes' }],
        createdAt: 'x',
        lastModifiedAt: 'x',
      }),
    })
    const { router } = renderAt('/terminal', { fetchImpl, viewComponent: StubView, ackStorage: ackedStorage() })

    // The Save action appears once Scratch has a pane.
    const save = await screen.findByRole('button', { name: /^save$/i })
    fireEvent.click(save)
    // Name the workspace + submit.
    const input = await screen.findByRole('textbox', { name: /name/i })
    fireEvent.change(input, { target: { value: 'My set' } })
    fireEvent.click(screen.getByRole('button', { name: /save workspace/i }))

    // The POST carried the pane's cli + label (each pane's cli + cwd).
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted!.name).toBe('My set')
    expect(posted!.panes).toEqual([{ id: 'term-1-abc123', label: 'Hermes 1', cli: 'hermes' }])
    // ...and the surface switched to the new workspace.
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces/saved-1'))
  })

  it('does not show Save when Scratch has no panes (launcher state)', async () => {
    renderAt('/terminal', { fetchImpl: deckFetch(), viewComponent: StubView, ackStorage: ackedStorage() })
    // The launcher is up (no live session), so there is nothing to save yet.
    await screen.findByRole('button', { name: /launch the raw shell/i })
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull()
  })
})

describe('TerminalSurface: deleting a saved workspace', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const TWO_WORKSPACES = {
    workspaces: [
      { id: 'ws-a', name: 'Alpha', paneCount: 2, createdAt: 'x', lastModifiedAt: 'x' },
      { id: 'ws-b', name: 'Beta', paneCount: 1, createdAt: 'x', lastModifiedAt: 'x' },
    ],
  }

  it('deleting a workspace from the switcher calls DELETE and drops it from the list', async () => {
    const calls: Array<{ url: string; method?: string }> = []
    const base = deckFetch({ workspaces: TWO_WORKSPACES })
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method })
      // After the DELETE, the list revalidation should no longer include Alpha.
      if (init?.method === 'DELETE') return jsonResponse({ ok: true })
      if (typeof url === 'string' && /\/terminal\/workspaces(\?|$)/.test(url)) {
        const deleted = calls.some((c) => c.method === 'DELETE')
        return jsonResponse(
          deleted ? { workspaces: TWO_WORKSPACES.workspaces.filter((w) => w.id !== 'ws-a') } : TWO_WORKSPACES,
        )
      }
      return (base as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init)
    }) as unknown as typeof fetch

    renderAt('/terminal', { fetchImpl, viewComponent: StubView, ackStorage: ackedStorage() })

    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    // Open the delete confirm for Alpha, then confirm it.
    fireEvent.click(within(switcher).getByRole('button', { name: /delete alpha/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    // The DELETE hit the right endpoint...
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/terminal/workspaces/ws-a'))).toBe(
        true,
      ),
    )
    // ...and Alpha is gone from the switcher after the revalidation.
    await waitFor(() =>
      expect(within(switcher).queryByRole('tab', { name: 'Alpha' })).toBeNull(),
    )
    expect(within(switcher).getByRole('tab', { name: 'Beta' })).toBeInTheDocument()
  })

  it('deleting the ACTIVE workspace returns to Scratch (/terminal)', async () => {
    const calls: Array<{ url: string; method?: string }> = []
    const base = deckFetch({
      workspaces: TWO_WORKSPACES,
      workspace: (id) => ({ id, name: 'Alpha', panes: [], createdAt: 'x', lastModifiedAt: 'x' }),
    })
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method })
      if (init?.method === 'DELETE') return jsonResponse({ ok: true })
      if (typeof url === 'string' && /\/terminal\/workspaces(\?|$)/.test(url)) {
        const deleted = calls.some((c) => c.method === 'DELETE')
        return jsonResponse(
          deleted ? { workspaces: TWO_WORKSPACES.workspaces.filter((w) => w.id !== 'ws-a') } : TWO_WORKSPACES,
        )
      }
      return (base as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init)
    }) as unknown as typeof fetch

    const { router } = renderAt('/workspaces/ws-a', {
      fetchImpl,
      viewComponent: StubView,
      ackStorage: ackedStorage(),
    })

    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    // Alpha is the active workspace; delete it.
    fireEvent.click(within(switcher).getByRole('button', { name: /delete alpha/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/terminal/workspaces/ws-a'))).toBe(
        true,
      ),
    )
    // Deleting the active workspace navigates back to Scratch.
    await waitFor(() => expect(router.state.location.pathname).toBe('/terminal'))
  })

  it('cancelling the delete confirm leaves the workspace in place and makes no DELETE', async () => {
    const calls: Array<{ url: string; method?: string }> = []
    const base = deckFetch({ workspaces: TWO_WORKSPACES })
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method })
      return (base as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init)
    }) as unknown as typeof fetch

    renderAt('/terminal', { fetchImpl, viewComponent: StubView, ackStorage: ackedStorage() })

    const switcher = await screen.findByRole('tablist', { name: /workspaces/i })
    fireEvent.click(within(switcher).getByRole('button', { name: /delete alpha/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(within(switcher).getByRole('tab', { name: 'Alpha' })).toBeInTheDocument()
  })
})
