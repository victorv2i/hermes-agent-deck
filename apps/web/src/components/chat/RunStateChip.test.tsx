import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { RunStateChip, LiveRunStateChip } from './RunStateChip'
import { formatSince } from '@/state/runState'
import { useChatStore } from '@/state/useChatStore'
import { initialChatState } from '@/state/chatStore'

const NOW = 1_780_000_000_000

afterEach(() => {
  cleanup()
  // Reset the module-global chat store between tests.
  act(() => {
    useChatStore.setState({
      ...initialChatState,
      nodes: undefined,
      branches: undefined,
      activeBranchId: null,
    })
  })
})

describe('RunStateChip (presentational, per state)', () => {
  it('renders nothing when idle — the chip disappears between runs', () => {
    const { container } = render(<RunStateChip state={null} signalAt={null} now={NOW} />)
    expect(container.firstChild).toBeNull()
  })

  it('working: calm muted treatment + honest detail with the last-signal age', () => {
    render(<RunStateChip state="working" signalAt={NOW - 3_000} now={NOW} />)
    const chip = screen.getByTestId('run-state-chip')
    expect(chip).toHaveTextContent('Working')
    expect(chip).toHaveAttribute('data-state', 'working')
    expect(chip.className).toContain('bg-muted')
    expect(chip.getAttribute('title')).toBe(
      'Your agent is actively responding. Last signal 3s ago.',
    )
  })

  it('thinking: soft copy ("Still thinking. Waiting on the model.")', () => {
    render(<RunStateChip state="thinking" signalAt={NOW - 25_000} now={NOW} />)
    const chip = screen.getByTestId('run-state-chip')
    expect(chip).toHaveTextContent('Still thinking')
    expect(chip.className).toContain('bg-muted')
    expect(chip.getAttribute('title')).toBe(
      'Still thinking. Waiting on the model. Last signal 25s ago.',
    )
  })

  it('waiting_approval: amber (warning) tone + "Waiting for your OK"', () => {
    render(<RunStateChip state="waiting_approval" signalAt={NOW - 5_000} now={NOW} />)
    const chip = screen.getByTestId('run-state-chip')
    expect(chip).toHaveTextContent('Waiting for your OK')
    expect(chip.className).toContain('text-warning')
    expect(chip.getAttribute('title')).toBe('Waiting for your OK')
  })

  it('maybe_stalled: amber tone + soft "may be stuck" copy (never a dead-certain claim)', () => {
    render(<RunStateChip state="maybe_stalled" signalAt={NOW - 130_000} now={NOW} />)
    const chip = screen.getByTestId('run-state-chip')
    expect(chip).toHaveTextContent('May be stuck')
    expect(chip.className).toContain('text-warning')
    expect(chip.getAttribute('title')).toBe(
      'No signal from your agent for a while. It may be stuck. Last signal 2m ago.',
    )
  })

  it('offline: the destructive tone, aligned with the existing connection-lost copy', () => {
    render(<RunStateChip state="offline" signalAt={NOW - 10_000} now={NOW} />)
    const chip = screen.getByTestId('run-state-chip')
    expect(chip).toHaveTextContent('Offline')
    expect(chip.className).toContain('text-destructive')
    expect(chip.getAttribute('title')).toBe('The link to the agent dropped. Reload to reconnect.')
  })

  it('never fabricates a last-signal age when no signal was observed', () => {
    render(<RunStateChip state="thinking" signalAt={null} now={NOW} />)
    const chip = screen.getByTestId('run-state-chip')
    expect(chip.getAttribute('title')).toBe('Still thinking. Waiting on the model.')
  })

  it('keeps the accessible status label STABLE per bucket (no per-second tick announcements)', () => {
    // The chip is a polite status region; its aria-label must not carry the
    // ticking "Xs ago" detail or screen readers would re-announce every second.
    render(<RunStateChip state="thinking" signalAt={NOW - 25_000} now={NOW} />)
    const chip = screen.getByTestId('run-state-chip')
    expect(chip.getAttribute('aria-label')).toBe('Still thinking. Waiting on the model.')
  })
})

describe('formatSince', () => {
  it('formats short ages in seconds and longer ones in minutes', () => {
    expect(formatSince(NOW - 7_000, NOW)).toBe('7s ago')
    expect(formatSince(NOW - 89_000, NOW)).toBe('89s ago')
    expect(formatSince(NOW - 90_000, NOW)).toBe('1m ago')
    expect(formatSince(NOW - 180_000, NOW)).toBe('3m ago')
  })

  it('returns null with no observed signal', () => {
    expect(formatSince(null, NOW)).toBeNull()
  })
})

describe('LiveRunStateChip (connected)', () => {
  it('renders nothing while no run is active', () => {
    render(<LiveRunStateChip connection="connected" />)
    expect(screen.queryByTestId('run-state-chip')).not.toBeInTheDocument()
  })

  it('shows working for an active run with a fresh event', () => {
    act(() => {
      useChatStore.setState({
        runStatus: 'running',
        lastEventAt: Date.now(),
        lastHeartbeatAt: null,
      })
    })
    render(<LiveRunStateChip connection="connected" />)
    expect(screen.getByTestId('run-state-chip')).toHaveAttribute('data-state', 'working')
  })

  it('an unanswered approval supersedes liveness (waiting_approval)', () => {
    act(() => {
      useChatStore.setState({
        runStatus: 'running',
        lastEventAt: Date.now(),
        pendingApproval: {
          run_id: 'r1',
          command: 'rm -rf ./build',
          description: 'delete',
          choices: ['once', 'deny'],
        },
      })
    })
    render(<LiveRunStateChip connection="connected" />)
    expect(screen.getByTestId('run-state-chip')).toHaveAttribute('data-state', 'waiting_approval')
  })

  it('a terminally disconnected socket reads offline while a run is active', () => {
    act(() => {
      useChatStore.setState({ runStatus: 'running', lastEventAt: Date.now() })
    })
    render(<LiveRunStateChip connection="disconnected" />)
    expect(screen.getByTestId('run-state-chip')).toHaveAttribute('data-state', 'offline')
  })
})

describe('LiveRunStateChip tick lifecycle (fake timers)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules NO interval while idle (no run, no timers)', () => {
    vi.useFakeTimers()
    render(<LiveRunStateChip connection="connected" />)
    expect(screen.queryByTestId('run-state-chip')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an active run starts the tick, and working crosses to thinking at the 10s boundary purely via the tick', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    act(() => {
      useChatStore.setState({ runStatus: 'running', lastEventAt: NOW, lastHeartbeatAt: NOW })
    })
    render(<LiveRunStateChip connection="connected" />)
    expect(screen.getByTestId('run-state-chip')).toHaveAttribute('data-state', 'working')
    // Exactly one chip-local interval is live.
    expect(vi.getTimerCount()).toBe(1)

    // 9s of silence: still inside the 10s working window.
    act(() => {
      vi.advanceTimersByTime(9_000)
    })
    expect(screen.getByTestId('run-state-chip')).toHaveAttribute('data-state', 'working')

    // No new event arrives; only the tick moves the clock past 10s. The chip
    // re-derives to thinking (the heartbeat still proves the stream alive).
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByTestId('run-state-chip')).toHaveAttribute('data-state', 'thinking')
  })

  it('cleans the interval up when the run goes idle (chip gone, no leaked timer)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    act(() => {
      useChatStore.setState({ runStatus: 'running', lastEventAt: NOW })
    })
    render(<LiveRunStateChip connection="connected" />)
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      useChatStore.setState({ runStatus: 'idle' })
    })
    expect(screen.queryByTestId('run-state-chip')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans the interval up on unmount', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    act(() => {
      useChatStore.setState({ runStatus: 'running', lastEventAt: NOW })
    })
    const { unmount } = render(<LiveRunStateChip connection="connected" />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
