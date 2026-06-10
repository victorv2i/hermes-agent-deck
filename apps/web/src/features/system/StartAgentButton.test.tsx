import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SystemGatewayState } from '@agent-deck/protocol'
import { statusKey } from '@/features/activity/useStatus'
import { modelsKey } from '@/features/models/useModels'
import { homeHealthKey, chatHealthKey } from '@/lib/api'
import { StartAgentButton } from './StartAgentButton'
import { START_AGENT_COPY } from './startAgentCopy'

// The button must REUSE the Maintenance dock's restart machinery: the only
// network call it may make is the dock's own POST (restartGateway).
const mockRestartGateway = vi.fn<() => Promise<SystemGatewayState>>()
vi.mock('./api', () => ({
  restartGateway: () => mockRestartGateway(),
  fetchSystem: vi.fn(),
  applyHermesUpdate: vi.fn(),
  runDoctor: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderButton() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StartAgentButton />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => {
  mockRestartGateway.mockReset()
})

describe('StartAgentButton', () => {
  it('renders the Start my agent action and fires the dock restart mutation on click', async () => {
    mockRestartGateway.mockResolvedValue({ status: 'running' })
    renderButton()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: START_AGENT_COPY.action }))
    expect(mockRestartGateway).toHaveBeenCalledTimes(1)
  })

  it('shows the honest pending copy and guards against double-clicks while starting', async () => {
    const gate = deferred<SystemGatewayState>()
    mockRestartGateway.mockReturnValue(gate.promise)
    renderButton()
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: START_AGENT_COPY.action })
    await user.click(button)

    // Pending: the copy claims only that a start was asked for, and the button
    // is disabled so a second click cannot fire a second restart.
    expect(await screen.findByText(START_AGENT_COPY.pending)).toBeInTheDocument()
    expect(button).toBeDisabled()
    await user.click(button)
    expect(mockRestartGateway).toHaveBeenCalledTimes(1)

    gate.resolve({ status: 'running' })
    expect(await screen.findByText(START_AGENT_COPY.started)).toBeInTheDocument()
  })

  it('on a failed call: says so plainly and points at the System page (the deeper path)', async () => {
    mockRestartGateway.mockRejectedValue(new Error('restart exited 1'))
    renderButton()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: START_AGENT_COPY.action }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(START_AGENT_COPY.failureLead)
    const link = screen.getByRole('link', { name: START_AGENT_COPY.failureLink })
    expect(link).toHaveAttribute('href', '/system')
    // The button stays available for a retry.
    expect(screen.getByRole('button', { name: START_AGENT_COPY.action })).toBeEnabled()
  })

  it('treats a re-probe that is NOT running as a failure, never a faked success', async () => {
    // The BFF restarts then re-probes; the result is the gateway's ACTUAL state.
    mockRestartGateway.mockResolvedValue({ status: 'failed' })
    renderButton()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: START_AGENT_COPY.action }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(START_AGENT_COPY.failureLead)
    expect(screen.queryByText(START_AGENT_COPY.started)).not.toBeInTheDocument()
  })

  it('on a re-probed running state: reports the probe and invalidates the gating reads (no faked recovery)', async () => {
    mockRestartGateway.mockResolvedValue({ status: 'running' })
    const client = renderButton()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: START_AGENT_COPY.action }))

    // The copy states the re-probed fact; the surfaces recover via their own
    // probes, which `useRestartGateway` nudges (hook-level) so the notice
    // clears from real re-reads.
    expect(await screen.findByText(START_AGENT_COPY.started)).toBeInTheDocument()
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(statusKey))
    expect(keys).toContain(JSON.stringify(modelsKey))
    expect(keys).toContain(JSON.stringify(homeHealthKey))
    expect(keys).toContain(JSON.stringify(chatHealthKey))
  })

  it('treats started as transient: if still mounted after 30s, the button honestly returns', async () => {
    // On a REAL recovery the caller's gate unmounts this chip within seconds
    // (the invalidated probes re-read). If the agent flapped back down, the
    // chip is still mounted next to a "not running" notice; it must not pin
    // that contradiction forever with no retry affordance.
    vi.useFakeTimers()
    try {
      mockRestartGateway.mockResolvedValue({ status: 'running' })
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: START_AGENT_COPY.action }))
      // Flush the resolved mutation (React Query batches its notify through a
      // setTimeout(0), which fake timers hold).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText(START_AGENT_COPY.started)).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
        // The reset lands ON the 30s boundary and React Query notifies through
        // another setTimeout(0) (clamped to 1ms), so nudge past the boundary.
        await vi.advanceTimersByTimeAsync(5)
      })
      expect(screen.queryByText(START_AGENT_COPY.started)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: START_AGENT_COPY.action })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
