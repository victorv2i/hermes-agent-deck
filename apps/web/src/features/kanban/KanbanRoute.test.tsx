import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { KanbanBoardResponse } from '@agent-deck/protocol'
import { availableBoard, makeCard } from './testFixtures'

/**
 * Mock `socket.io-client` so the live `/kanban` channel is a controllable fake.
 * The route uses the real socket by default (no test-only prop), so we intercept
 * `io()` and expose the handler registry for the test to fire snapshots.
 */
const liveHandlers = new Map<string, ((...a: unknown[]) => void)[]>()
function fireLive(event: string, ...args: unknown[]) {
  for (const l of liveHandlers.get(event) ?? []) l(...args)
}
vi.mock('socket.io-client', () => {
  return {
    io: () => ({
      connected: false,
      on(event: string, listener: (...a: unknown[]) => void) {
        const list = liveHandlers.get(event) ?? []
        list.push(listener)
        liveHandlers.set(event, list)
        return this
      },
      off() {
        return this
      },
      emit() {
        return this
      },
      connect() {
        this.connected = true
        fireLive('connect')
        return this
      },
      disconnect() {
        this.connected = false
        return this
      },
    }),
  }
})

// Import AFTER the mock is registered.
import { KanbanRoute } from './KanbanRoute'

/** A stateful REST backend the fetch stub serves (board + boards + task). */
function mockBackend(board: KanbanBoardResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://x')
    const p = url.pathname
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    if (p === '/api/agent-deck/kanban/board') return json(board)
    if (p === '/api/agent-deck/kanban/boards') return json({ available: false })
    if (p.startsWith('/api/agent-deck/kanban/tasks/')) {
      return json({
        available: true,
        data: {
          card: makeCard({ id: 't_run', column: 'running' }),
          body: 'Build the live board.',
          latestSummary: 'Wiring the socket.',
          comments: [],
          events: [],
          runs: [],
          links: { parents: [], children: [] },
        },
      })
    }
    return json({ available: false })
  })
  return fetchMock
}

/** Surface the current `?board=`/`?card=` so we can assert the URL the route drives. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="search">{loc.search}</div>
}

function renderRoute(initial = '/kanban') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/kanban" element={children} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(<KanbanRoute />, { wrapper })
}

beforeEach(() => {
  liveHandlers.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('KanbanRoute', () => {
  it('loads the board and renders its columns + cards', async () => {
    vi.stubGlobal(
      'fetch',
      mockBackend(availableBoard({ todo: [makeCard({ id: 't_a', title: 'A queued task' })] })),
    )
    renderRoute()
    expect(await screen.findByText('A queued task')).toBeInTheDocument()
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(8)
  })

  it('moves a card live when a kanban.snapshot arrives (no refetch)', async () => {
    // Initial board: the card is in `todo`.
    vi.stubGlobal(
      'fetch',
      mockBackend(
        availableBoard({
          todo: [makeCard({ id: 't_move', title: 'Migrating task', column: 'todo' })],
        }),
      ),
    )
    renderRoute()
    await screen.findByText('Migrating task')

    const todoCol = () =>
      screen.getAllByTestId('kanban-column').find((c) => c.getAttribute('data-column') === 'todo')!
    const runningCol = () =>
      screen
        .getAllByTestId('kanban-column')
        .find((c) => c.getAttribute('data-column') === 'running')!

    // Initially the card lives in todo.
    expect(todoCol()).toHaveTextContent('Migrating task')
    expect(runningCol()).not.toHaveTextContent('Migrating task')

    // A live snapshot moves it to `running` with a worker — pushed straight into
    // the cache by useKanbanLive, no fetch.
    const moved = availableBoard(
      {
        running: [
          makeCard({
            id: 't_move',
            title: 'Migrating task',
            column: 'running',
            worker: {
              id: 5,
              profile: 'builder',
              status: 'running',
              outcome: null,
              summary: null,
              startedAt: 1_700_000_000,
              endedAt: null,
            },
          }),
        ],
      },
      { cursor: 2 },
    )
    act(() => fireLive('kanban.snapshot', moved))

    await waitFor(() => {
      expect(runningCol()).toHaveTextContent('Migrating task')
      expect(todoCol()).not.toHaveTextContent('Migrating task')
    })
  })

  it('opens the task drawer when a card is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      mockBackend(
        availableBoard({
          running: [makeCard({ id: 't_run', title: 'Live task', column: 'running' })],
        }),
      ),
    )
    renderRoute()
    await screen.findByText('Live task')

    await userEvent.click(screen.getByText('Live task'))
    const drawer = await screen.findByTestId('kanban-task-drawer')
    expect(within(drawer).getByText('Build the live board.')).toBeInTheDocument()
  })

  it('reflects the open card in `?card=` so a refresh keeps the drawer open', async () => {
    vi.stubGlobal(
      'fetch',
      mockBackend(
        availableBoard({
          running: [makeCard({ id: 't_run', title: 'Live task', column: 'running' })],
        }),
      ),
    )
    renderRoute()
    await screen.findByText('Live task')

    await userEvent.click(screen.getByText('Live task'))
    await screen.findByTestId('kanban-task-drawer')
    // The open card is in the URL → refresh-stable + deep-linkable.
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('card=t_run'))
  })

  it('opens the drawer for a deep-linked `?card=` on first load', async () => {
    vi.stubGlobal(
      'fetch',
      mockBackend(
        availableBoard({
          running: [makeCard({ id: 't_run', title: 'Live task', column: 'running' })],
        }),
      ),
    )
    // Land directly on a `?card=` URL (a shared deep link / a refresh).
    renderRoute('/kanban?card=t_run')

    const drawer = await screen.findByTestId('kanban-task-drawer')
    expect(await within(drawer).findByText('Build the live board.')).toBeInTheDocument()
  })

  it('drives the selected board through `?board=`', async () => {
    vi.stubGlobal(
      'fetch',
      mockBackend(availableBoard({ todo: [makeCard({ id: 't_a', title: 'A queued task' })] })),
    )
    // A deep-linked board slug rides `?board=` and is sent to the BFF.
    const fetchMock = mockBackend(
      availableBoard({ todo: [makeCard({ id: 't_a', title: 'A queued task' })] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/kanban?board=alpha')
    await screen.findByText('A queued task')

    await waitFor(() => {
      const requested = fetchMock.mock.calls.some(([input]) => {
        const u = new URL(String(input), 'http://x')
        return (
          u.pathname === '/api/agent-deck/kanban/board' && u.searchParams.get('board') === 'alpha'
        )
      })
      expect(requested).toBe(true)
    })
  })

  it('renders the enable-plugin empty state when the BFF says unavailable', async () => {
    vi.stubGlobal('fetch', mockBackend({ available: false }))
    renderRoute()
    expect(await screen.findByText(/Task tracking isn.t enabled yet/i)).toBeInTheDocument()
  })

  it('expands the board into a full-viewport overlay and collapses it', async () => {
    vi.stubGlobal(
      'fetch',
      mockBackend(availableBoard({ todo: [makeCard({ id: 't_a', title: 'A queued task' })] })),
    )
    renderRoute()
    await screen.findByText('A queued task')

    await userEvent.click(screen.getByTestId('kanban-expand'))
    const overlay = await screen.findByTestId('kanban-expanded')
    expect(within(overlay).getByText('A queued task')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('kanban-collapse'))
    await waitFor(() => expect(screen.queryByTestId('kanban-expanded')).not.toBeInTheDocument())
  })

  it('moves a card via the menu (optimistic) and POSTs the real move route', async () => {
    const fetchMock = mockBackend(
      availableBoard({ todo: [makeCard({ id: 't_mv', title: 'Movable', column: 'todo' })] }),
    )
    // The move POST succeeds.
    const orig = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://x')
      if (url.pathname.endsWith('/move') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return orig(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await screen.findByText('Movable')

    await userEvent.click(screen.getByLabelText('Move to column'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /ready/i }))

    // The real move route was POSTed.
    await waitFor(() => {
      const posted = fetchMock.mock.calls.some(([input, init]) => {
        const u = new URL(String(input), 'http://x')
        return u.pathname === '/api/agent-deck/kanban/tasks/t_mv/move' && init?.method === 'POST'
      })
      expect(posted).toBe(true)
    })
  })

  it('creates a card through the composer, POSTing the real create route', async () => {
    const fetchMock = mockBackend(availableBoard({ todo: [] }))
    const orig = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://x')
      if (url.pathname === '/api/agent-deck/kanban/tasks' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 't_created' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return orig(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute()
    await screen.findByRole('button', { name: /new card/i })

    await userEvent.click(screen.getByRole('button', { name: /new card/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Fresh task')
    await userEvent.click(within(dialog).getByRole('button', { name: /create card/i }))

    await waitFor(() => {
      const posted = fetchMock.mock.calls.some(([input, init]) => {
        const u = new URL(String(input), 'http://x')
        return u.pathname === '/api/agent-deck/kanban/tasks' && init?.method === 'POST'
      })
      expect(posted).toBe(true)
    })
  })
})
