import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { PaneRuntimeState } from '@agent-deck/protocol'
import { PaneAwarenessChip } from './PaneAwarenessChip'

function renderIt(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function stubPaneState(state: PaneRuntimeState) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => state }) as Response),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('PaneAwarenessChip', () => {
  it('renders the run state, last tool, and the file basename when working', async () => {
    stubPaneState({
      cli: 'claude',
      runState: 'working',
      activeFile: '/home/u/app/src/server.ts',
      lastTool: 'Edit',
      sessionId: 's1',
      updatedAt: '2026-06-17T10:00:00Z',
    })
    renderIt(<PaneAwarenessChip cli="claude" cwd="/home/u/app" />)
    await waitFor(() => expect(screen.getByText('working')).toBeInTheDocument())
    expect(screen.getByText('Edit')).toBeInTheDocument()
    // Basename only, not the full path.
    expect(screen.getByText('server.ts')).toBeInTheDocument()
    expect(screen.queryByText('/home/u/app/src/server.ts')).not.toBeInTheDocument()
  })

  it('renders nothing when the pane state is unknown', async () => {
    stubPaneState({
      cli: 'claude',
      runState: 'unknown',
      activeFile: null,
      lastTool: null,
      sessionId: null,
      updatedAt: null,
    })
    const { container } = renderIt(<PaneAwarenessChip cli="claude" cwd="/home/u/app" />)
    // Give the (resolved) query a tick; it should still render nothing.
    await new Promise((r) => setTimeout(r, 10))
    expect(container.textContent).toBe('')
  })

  it('does not fetch for a non-aware CLI (shell)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { container } = renderIt(<PaneAwarenessChip cli="shell" cwd="/home/u/app" />)
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })

  it('does not fetch when the pane has no cwd', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderIt(<PaneAwarenessChip cli="claude" cwd={undefined} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
