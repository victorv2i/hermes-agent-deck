import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { ActivePanesResponse } from '@agent-deck/protocol'
import { ActivePanesRow } from './ActivePanesRow'

function renderIt(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function stub(body: ActivePanesResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('ActivePanesRow', () => {
  it('renders nothing when there are no active panes', async () => {
    stub({ panes: [], workingCount: 0 })
    const { container } = renderIt(<ActivePanesRow />)
    await new Promise((r) => setTimeout(r, 10))
    expect(container.textContent).toBe('')
  })

  it('shows the pane count, working count, labels, and file basenames', async () => {
    stub({
      panes: [
        {
          cli: 'claude',
          runState: 'working',
          activeFile: '/work/app/src/server.ts',
          lastTool: 'Edit',
          sessionId: 's1',
          updatedAt: null,
          workspaceId: 'ws1',
          workspaceName: 'Build',
          paneId: 'p1',
          label: 'Builder',
        },
        {
          cli: 'codex',
          runState: 'idle',
          activeFile: null,
          lastTool: 'exec_command',
          sessionId: 's2',
          updatedAt: null,
          workspaceId: 'ws1',
          workspaceName: 'Build',
          paneId: 'p2',
          label: 'Helper',
        },
      ],
      workingCount: 1,
    })
    renderIt(<ActivePanesRow />)
    await waitFor(() => expect(screen.getByTestId('active-panes-count')).toHaveTextContent('2'))
    expect(screen.getByTestId('active-panes-working')).toHaveTextContent('1 working')
    expect(screen.getByText('Builder')).toBeInTheDocument()
    expect(screen.getByText('Helper')).toBeInTheDocument()
    expect(screen.getByText('server.ts')).toBeInTheDocument()
    // The pane links to its workspace.
    expect(screen.getByText('Builder').closest('a')).toHaveAttribute('href', '/workspaces/ws1')
  })
})
