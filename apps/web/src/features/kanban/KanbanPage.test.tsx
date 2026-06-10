import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KanbanPage } from './KanbanPage'
import type { KanbanPageProps } from './KanbanPage'
import { availableBoard, makeCard } from './testFixtures'

function baseProps(over: Partial<KanbanPageProps> = {}): KanbanPageProps {
  return {
    board: availableBoard(),
    boards: [],
    selectedBoard: 'main',
    onSelectBoard: vi.fn(),
    liveStatus: 'connected',
    isLoading: false,
    isFetching: false,
    error: null,
    onRetry: vi.fn(),
    onOpenCard: vi.fn(),
    expanded: false,
    onToggleExpanded: vi.fn(),
    ...over,
  }
}

function mockSmallViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('KanbanPage', () => {
  it('renders the 8 ordered columns with their cards from a snapshot', () => {
    const props = baseProps({
      board: availableBoard({
        todo: [makeCard({ id: 't_a', title: 'Draft the spec' })],
        done: [makeCard({ id: 't_b', title: 'Land the BFF', column: 'done' })],
      }),
    })
    render(<KanbanPage {...props} />)

    const columns = screen.getAllByTestId('kanban-column')
    // 8 governed columns (archived hidden by default + not present in the snapshot).
    expect(columns).toHaveLength(8)
    expect(columns.map((c) => c.getAttribute('data-column'))).toEqual([
      'triage',
      'todo',
      'scheduled',
      'ready',
      'running',
      'blocked',
      'review',
      'done',
    ])
    expect(screen.getByText('Draft the spec')).toBeInTheDocument()
    expect(screen.getByText('Land the BFF')).toBeInTheDocument()
    expect(screen.getByText('Incoming has no cards yet.')).toBeInTheDocument()
    // The lane lives in the affordance-carrying scroller (resting scrollbar + fades).
    const scroller = screen.getByTestId('kanban-board-scroller')
    expect(within(scroller).getByTestId('kanban-board')).toBeInTheDocument()
  })

  it('offers a mobile lane selector with one full-width selected lane', async () => {
    mockSmallViewport()
    render(
      <KanbanPage
        {...baseProps({
          board: availableBoard({
            todo: [makeCard({ id: 't_a', title: 'Draft the spec' })],
            done: [makeCard({ id: 't_b', title: 'Land the BFF', column: 'done' })],
          }),
        })}
      />,
    )

    expect(screen.getByTestId('kanban-mobile-board')).toBeInTheDocument()
    const lane = screen.getByLabelText('Lane')
    expect(lane).toHaveValue('todo')
    expect(lane.className).toContain('h-11')
    expect(screen.getByTestId('kanban-mobile-column')).toHaveAttribute('data-column', 'todo')

    await userEvent.selectOptions(lane, 'done')
    expect(screen.getByTestId('kanban-mobile-column')).toHaveAttribute('data-column', 'done')
    expect(
      within(screen.getByTestId('kanban-mobile-column')).getByText('Land the BFF'),
    ).toBeInTheDocument()
  })

  it('shows the live worker indicator in the running column', () => {
    const props = baseProps({
      board: availableBoard({
        running: [
          makeCard({
            id: 't_run',
            column: 'running',
            worker: {
              id: 1,
              profile: 'builder',
              status: 'running',
              outcome: null,
              summary: null,
              startedAt: 1_700_000_000,
              endedAt: null,
            },
          }),
        ],
      }),
    })
    render(<KanbanPage {...props} />)

    const running = screen
      .getAllByTestId('kanban-column')
      .find((c) => c.getAttribute('data-column') === 'running')!
    expect(within(running).getByTestId('kanban-card-worker')).toHaveTextContent('builder')
  })

  it('renders the calm enable-plugin empty state when unavailable (never an error)', () => {
    render(<KanbanPage {...baseProps({ board: { available: false } })} />)
    expect(screen.getByText(/Task tracking isn’t enabled yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()
    // The board selector + live dot are hidden in the unavailable state.
    expect(screen.queryByTestId('kanban-live-dot')).not.toBeInTheDocument()
  })

  it('shows an error state (with retry) when the read failed', () => {
    const onRetry = vi.fn()
    render(<KanbanPage {...baseProps({ error: new Error('boom'), onRetry })} />)
    expect(screen.getByText(/Couldn’t load the board/i)).toBeInTheDocument()
  })

  it('hides the board selector with a single board and shows it with several', () => {
    const { rerender } = render(
      <KanbanPage
        {...baseProps({
          boards: [
            {
              slug: 'main',
              name: 'Main',
              description: '',
              icon: '',
              color: '',
              isCurrent: true,
              total: 3,
              counts: {},
            },
          ],
        })}
      />,
    )
    expect(screen.queryByLabelText('Board')).not.toBeInTheDocument()

    rerender(
      <KanbanPage
        {...baseProps({
          boards: [
            {
              slug: 'main',
              name: 'Main',
              description: '',
              icon: '',
              color: '',
              isCurrent: true,
              total: 3,
              counts: {},
            },
            {
              slug: 'alt',
              name: 'Alt',
              description: '',
              icon: '',
              color: '',
              isCurrent: false,
              total: 1,
              counts: {},
            },
          ],
        })}
      />,
    )
    expect(screen.getByLabelText('Board')).toBeInTheDocument()
  })

  it('renders a live status dot reflecting the socket state', () => {
    render(<KanbanPage {...baseProps({ liveStatus: 'connected' })} />)
    const dot = screen.getByTestId('kanban-live-dot')
    expect(dot).toHaveAttribute('data-status', 'connected')
    expect(dot).toHaveTextContent('Live')
  })

  it('exposes an expand toggle that calls onToggleExpanded', async () => {
    const onToggleExpanded = vi.fn()
    render(<KanbanPage {...baseProps({ onToggleExpanded })} />)
    const toggle = screen.getByTestId('kanban-expand')
    expect(toggle).toHaveAttribute('aria-label', expect.stringMatching(/expand/i))
    expect(toggle.className).toContain('size-11')
    await userEvent.click(toggle)
    expect(onToggleExpanded).toHaveBeenCalledTimes(1)
  })

  it('renders the board lane inside a full-viewport overlay when expanded, with a Collapse control', () => {
    const onToggleExpanded = vi.fn()
    render(
      <KanbanPage
        {...baseProps({
          expanded: true,
          onToggleExpanded,
          board: availableBoard({ todo: [makeCard({ id: 't_x', title: 'In the overlay' })] }),
        })}
      />,
    )
    const overlay = screen.getByTestId('kanban-expanded')
    expect(overlay).toBeInTheDocument()
    // The board lane (and its cards) lives inside the overlay.
    expect(within(overlay).getByText('In the overlay')).toBeInTheDocument()
    // A clear collapse control with the Esc hint.
    const collapse = screen.getByTestId('kanban-collapse')
    expect(collapse).toHaveAttribute('aria-keyshortcuts', 'Escape')
  })

  it('shows a New card action that calls onCreateCard (hidden when no handler)', async () => {
    const onCreateCard = vi.fn()
    const { rerender } = render(<KanbanPage {...baseProps({ onCreateCard })} />)
    const btn = screen.getByRole('button', { name: /new card/i })
    await userEvent.click(btn)
    expect(onCreateCard).toHaveBeenCalledTimes(1)

    rerender(<KanbanPage {...baseProps({ onCreateCard: undefined })} />)
    expect(screen.queryByRole('button', { name: /new card/i })).not.toBeInTheDocument()
  })

  it('threads the move handler to a card move control', async () => {
    const onMoveCard = vi.fn()
    render(
      <KanbanPage
        {...baseProps({
          onMoveCard,
          board: availableBoard({
            todo: [makeCard({ id: 't_mv', title: 'Movable', column: 'todo' })],
          }),
        })}
      />,
    )
    // Open the card's move menu and pick a target.
    await userEvent.click(screen.getByLabelText('Move to column'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /ready/i }))
    expect(onMoveCard).toHaveBeenCalledWith('t_mv', 'ready')
  })

  it('offers no archived toggle and never renders an archived column (honest UI)', () => {
    // The upstream /board omits archived cards and the BFF never requests them, so an
    // archived toggle could only ever do nothing. There must be no dead control, and a
    // stray archived column (should one ever arrive) is filtered out, not surfaced.
    const board = availableBoard({ todo: [makeCard()] })
    if (board.available) {
      board.data.columns.push({
        name: 'archived',
        cards: [makeCard({ id: 't_arch', column: 'archived' })],
      })
    }

    render(<KanbanPage {...baseProps({ board })} />)
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen
        .getAllByTestId('kanban-column')
        .find((c) => c.getAttribute('data-column') === 'archived'),
    ).toBeUndefined()
  })
})
