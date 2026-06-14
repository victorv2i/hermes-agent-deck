import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { KanbanStats } from '@agent-deck/protocol'
import { BoardStatsBar } from './BoardStatsBar'

function stats(over: Partial<KanbanStats> = {}): KanbanStats {
  return { byStatus: {}, byAssignee: {}, oldestReadyAgeSeconds: null, now: 1000, ...over }
}

describe('BoardStatsBar', () => {
  it('renders nothing when stats are unavailable', () => {
    const { container } = render(<BoardStatsBar stats={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on an idle board (no running or ready work)', () => {
    const { container } = render(
      <BoardStatsBar stats={stats({ byStatus: { done: 6, blocked: 1 } })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows running + ready counts and the oldest wait when work is queued', () => {
    render(
      <BoardStatsBar
        stats={stats({ byStatus: { running: 3, ready: 2 }, oldestReadyAgeSeconds: 600 })}
      />,
    )
    expect(screen.getByText(/3 running/i)).toBeInTheDocument()
    expect(screen.getByText(/2 ready/i)).toBeInTheDocument()
    // 600s formatted, on the "oldest waiting" line (answers "why isn't it running")
    expect(screen.getByText(/waiting 10m/i)).toBeInTheDocument()
  })

  it('shows running only (no ready chip, no wait line) when the queue is empty', () => {
    render(<BoardStatsBar stats={stats({ byStatus: { running: 1 } })} />)
    expect(screen.getByText(/1 running/i)).toBeInTheDocument()
    expect(screen.queryByText(/ready/i)).toBeNull()
    expect(screen.queryByText(/waiting/i)).toBeNull()
  })
})
