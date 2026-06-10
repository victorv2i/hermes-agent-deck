import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoardCard } from './BoardCard'
import { makeCard } from './testFixtures'

describe('BoardCard', () => {
  it('renders the title + assignee chip and fires onOpen with the card id', async () => {
    const onOpen = vi.fn()
    render(
      <BoardCard
        card={makeCard({ id: 't_1', title: 'Ship the board', assignee: 'coder' })}
        onOpen={onOpen}
      />,
    )

    expect(screen.getByText('Ship the board')).toBeInTheDocument()
    expect(screen.getByText('coder')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('kanban-card'))
    expect(onOpen).toHaveBeenCalledWith('t_1')
  })

  it('shows the live worker strip for a running card', () => {
    render(
      <BoardCard
        card={makeCard({
          column: 'running',
          worker: {
            id: 9,
            profile: 'builder',
            status: 'running',
            outcome: null,
            summary: null,
            startedAt: 1_700_000_000,
            endedAt: null,
          },
        })}
        onOpen={vi.fn()}
      />,
    )
    const strip = screen.getByTestId('kanban-card-worker')
    expect(strip).toBeInTheDocument()
    expect(strip).toHaveTextContent('builder')
  })

  it('renders no worker strip for a non-running card', () => {
    render(<BoardCard card={makeCard({ column: 'todo' })} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('kanban-card-worker')).not.toBeInTheDocument()
  })

  it('caps an enormous prompt-derived title but keeps the full text reachable', () => {
    // Tasks created from a chat run use the whole prompt as the title; a card must
    // stay scannable (short, single-line display) while the full text is on hover.
    const fullTitle = `Rebuild the deck\n\n${'spec detail '.repeat(2000)}`.trim()
    render(<BoardCard card={makeCard({ id: 't_big', title: fullTitle })} onOpen={vi.fn()} />)

    const titleEl = screen.getByTestId('kanban-card-title')
    // Display is the capped first line, not the 19k-char body.
    expect(titleEl.textContent ?? '').toBe('Rebuild the deck')
    expect((titleEl.textContent ?? '').length).toBeLessThan(100)
    // The full, untruncated title remains available via the native tooltip.
    expect(titleEl).toHaveAttribute('title', fullTitle)
  })

  it('marks an unassigned card honestly', () => {
    render(<BoardCard card={makeCard({ assignee: null })} onOpen={vi.fn()} />)
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('opens on Enter/Space (keyboard parity on the role=button tile)', async () => {
    const onOpen = vi.fn()
    render(<BoardCard card={makeCard({ id: 't_kb' })} onOpen={onOpen} />)
    const tile = screen.getByTestId('kanban-card')
    tile.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('t_kb')
  })

  it('fires onMove via the move menu and never bubbles into onOpen', async () => {
    const onOpen = vi.fn()
    const onMove = vi.fn()
    render(
      <BoardCard card={makeCard({ id: 't_mv', column: 'todo' })} onOpen={onOpen} onMove={onMove} />,
    )
    await userEvent.click(screen.getByLabelText('Move to column'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /done/i }))
    expect(onMove).toHaveBeenCalledWith('t_mv', 'done')
    // Opening the move menu must not also open the card drawer.
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('keeps the move control visible and touch-sized before desktop hover compaction', () => {
    render(<BoardCard card={makeCard({ column: 'todo' })} onOpen={vi.fn()} onMove={vi.fn()} />)
    const move = screen.getByLabelText('Move to column')
    expect(move.className).toContain('size-11')
    expect(move.className).toContain('md:size-7')
    expect(move.parentElement?.className).toContain('opacity-100')
    expect(move.parentElement?.className).toContain('md:opacity-0')
  })

  it('hides the move control when no onMove is provided (read-only)', () => {
    render(<BoardCard card={makeCard()} onOpen={vi.fn()} />)
    expect(screen.queryByLabelText('Move to column')).not.toBeInTheDocument()
  })

  it('shows comment + progress + warning badges when present', () => {
    render(
      <BoardCard
        card={makeCard({
          commentCount: 3,
          progress: { done: 2, total: 5 },
          warnings: { count: 1, highestSeverity: 'error' },
        })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders the warnings badge as an honest count-only status indicator (not a gateway to nonexistent detail)', () => {
    // The warnings data is a count + severity rollup; no per-rule detail crosses the
    // BFF. So the badge must carry its full meaning itself (an accessible label /
    // tooltip stating the count + severity) rather than implying clickable detail.
    render(
      <BoardCard
        card={makeCard({ warnings: { count: 3, highestSeverity: 'warning' } })}
        onOpen={vi.fn()}
      />,
    )
    const badge = screen.getByTestId('kanban-card-warnings')
    expect(badge).toHaveAttribute('title', '3 warnings (highest: warning)')
    expect(badge).toHaveAttribute('aria-label', '3 warnings (highest: warning)')
    // It is not its own interactive control — it is a plain status span.
    expect(badge.tagName).toBe('SPAN')
    expect(badge).not.toHaveAttribute('role', 'button')
  })

  it('singularizes the warnings label and copes with a missing severity honestly', () => {
    render(
      <BoardCard
        card={makeCard({ warnings: { count: 1, highestSeverity: null } })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByTestId('kanban-card-warnings')).toHaveAttribute('title', '1 warning')
  })

  const runningCard = (over = {}) =>
    makeCard({
      id: 't_run',
      column: 'running',
      worker: {
        id: 9,
        profile: 'builder',
        status: 'running',
        outcome: null,
        summary: null,
        startedAt: 1_700_000_000,
        endedAt: null,
      },
      ...over,
    })

  it('shows a Stop control on a running card and fires onStop with the run id (not opening)', async () => {
    const onStop = vi.fn()
    const onOpen = vi.fn()
    render(<BoardCard card={runningCard()} onOpen={onOpen} onStop={onStop} />)

    const stop = screen.getByTestId('kanban-card-stop')
    await userEvent.click(stop)
    expect(onStop).toHaveBeenCalledWith('t_run', 9)
    // The Stop click must NOT bubble up and open the drawer.
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('gives the Stop control a touch-sized tap target on mobile (shrinks on desktop)', () => {
    render(<BoardCard card={runningCard()} onOpen={vi.fn()} onStop={vi.fn()} />)
    const stop = screen.getByTestId('kanban-card-stop')
    expect(stop.className).toContain('size-11')
    expect(stop.className).toContain('md:size-5')
  })

  it('hides Stop when onStop is absent (read-only board)', () => {
    render(<BoardCard card={runningCard()} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('kanban-card-stop')).not.toBeInTheDocument()
  })

  it('hides Stop on a running card with no live run id (honest -- nothing to key)', () => {
    render(<BoardCard card={runningCard({ worker: null })} onOpen={vi.fn()} onStop={vi.fn()} />)
    expect(screen.queryByTestId('kanban-card-stop')).not.toBeInTheDocument()
  })
})
