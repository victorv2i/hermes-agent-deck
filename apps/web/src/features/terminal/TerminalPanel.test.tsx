/**
 * Tests for the TERMINAL DOCK panel — a single-session terminal that lives in the
 * right side panel. It reuses the same availability probe + xterm view as the
 * `/terminal` surface, honors the SAME honest "unavailable" gating, mounts ONE
 * session through the dock's persisted stable id (park/reattach), and offers an
 * "Open full Terminal" link to the multi-terminal power tool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect, type ReactElement } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TerminalPanel } from './TerminalPanel'
import { TERMINAL_ACK_KEY, type AckStorage } from './useTerminalAcknowledged'
import { useTerminalPanelStore } from './terminalPanelStore'
import type { TerminalViewProps } from './TerminalView'

function renderPanel(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

/** A fetch that answers the terminal status probe with the given payload. */
function statusFetch(status: unknown = { available: true }) {
  return vi.fn(async () => jsonResponse(status)) as unknown as typeof fetch
}

/** A fetch whose status probe FAILS (network/HTTP error). */
function failingFetch() {
  return vi.fn(async () => jsonResponse(null, false, 500)) as unknown as typeof fetch
}

/** In-memory ack storage seeded as already-acknowledged (skips the gate). */
function ackedStorage(): AckStorage {
  const map = new Map<string, string>([[TERMINAL_ACK_KEY, '1']])
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

/** A stub view capturing the props the dock hands it (sessionId etc.). */
let lastViewProps: TerminalViewProps | null = null
let viewMounts = 0
function StubView(props: TerminalViewProps) {
  useEffect(() => {
    viewMounts += 1
    // Capture the props the dock handed us in an effect (not during render).
    lastViewProps = props
    props.onStatusChange?.('connected')
    // Count TRUE React mounts (a Restart remounts via a key bump), not re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div data-testid="terminal-view">live dock terminal</div>
}

beforeEach(() => {
  localStorage.clear()
  lastViewProps = null
  viewMounts = 0
  // Pin a deterministic, stable dock id (resolved once at store creation in real
  // use) so the wire-id assertions are stable and render reads a fixed slice.
  useTerminalPanelStore.setState({ open: true, sessionId: 'dock-test-0001' })
})

describe('TerminalPanel', () => {
  it('shows the honest "unavailable" state when node-pty is not available', async () => {
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: false, reason: 'node-pty unavailable on this host' })}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/node-pty unavailable/i)).toBeInTheDocument()
    // The heavy xterm view must NOT mount when the backend is unavailable.
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('shows the honest "unavailable" state when the probe fails', async () => {
    renderPanel(
      <TerminalPanel
        fetchImpl={failingFetch()}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('shows the honest "no workspace" state when cwd is unavailable', async () => {
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true, cwd_available: false })}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('mounts ONE live session with the dock-persisted stable sessionId once available', async () => {
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true })}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
    expect(viewMounts).toBe(1)
    // The dock forwards a stable, dock-scoped wire session id (park/reattach key):
    // the persisted dock id plus the restart epoch (0 on a fresh mount/refresh).
    const id = lastViewProps?.sessionId
    expect(id).toBeTruthy()
    expect(id).toMatch(/^dock-/)
    // It's built from the SAME id the store persists for refresh-reattach.
    const stableId = useTerminalPanelStore.getState().dockSessionId()
    expect(id).toBe(`${stableId}:0`)
  })

  it('reads the stable dock id during render WITHOUT a render-phase store set (no side effect)', async () => {
    // Guard against the regression: computing the wire session id in the render
    // body must not call the store's set() (a set()-during-render side effect).
    const setSpy = vi.spyOn(useTerminalPanelStore, 'setState')
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true })}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    await screen.findByTestId('terminal-view')
    // The same stable wire id is forwarded across renders, never re-minted/mutated.
    expect(lastViewProps?.sessionId).toBe('dock-test-0001:0')
    expect(setSpy).not.toHaveBeenCalled()
    setSpy.mockRestore()
  })

  it('renders an "Open full Terminal" link to /terminal (the multi-terminal power tool)', async () => {
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true })}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    const link = await screen.findByRole('link', { name: /open full terminal/i })
    expect(link).toHaveAttribute('href', '/terminal')
  })

  it('has a close control that closes the dock store', async () => {
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true })}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    const close = await screen.findByRole('button', { name: /close terminal/i })
    fireEvent.click(close)
    await waitFor(() => expect(useTerminalPanelStore.getState().open).toBe(false))
  })

  it('Restart remounts the session view (fresh shell)', async () => {
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true })}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    await screen.findByTestId('terminal-view')
    expect(viewMounts).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    await waitFor(() => expect(viewMounts).toBe(2))
  })

  it('real-shell alertdialog gate has aria-describedby pointing to its body paragraph', async () => {
    const map = new Map<string, string>()
    const freshStorage: AckStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    }
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true })}
        viewComponent={StubView}
        ackStorage={freshStorage}
      />,
    )
    const dialog = await screen.findByRole('alertdialog', { name: /real shell warning/i })
    const descId = dialog.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId!)).toBeInTheDocument()
  })

  it('does not connect a socket until the real-shell gate is acknowledged', async () => {
    // Fresh (un-acked) storage: the consent gate stands before any session mounts.
    const map = new Map<string, string>()
    const freshStorage: AckStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    }
    renderPanel(
      <TerminalPanel
        fetchImpl={statusFetch({ available: true })}
        viewComponent={StubView}
        ackStorage={freshStorage}
      />,
    )
    // The gate is shown; no live view yet.
    expect(await screen.findByRole('button', { name: /open the terminal/i })).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open the terminal/i }))
    expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
  })
})
