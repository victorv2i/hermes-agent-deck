import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect, type ReactElement } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TerminalRoute } from './TerminalRoute'
import { TERMINAL_ACK_KEY, type AckStorage } from './useTerminalAcknowledged'
import { TERMINAL_SESSIONS_KEY } from './terminalSessions'
import type { TerminalViewProps } from './TerminalView'

/** The surface probes terminal status via useTerminalStatus → useQuery, so each
 * render gets a throwaway client (retries off for deterministic error states). */
function renderRoute(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

const CLIS_OK = {
  clis: [
    { id: 'hermes', label: 'Hermes CLI', available: true },
    { id: 'claude', label: 'Claude Code', available: false, installUrl: 'https://x/claude' },
    { id: 'codex', label: 'Codex', available: true },
    { id: 'shell', label: 'Raw shell', available: true },
  ],
}

/** A fetch that answers BOTH the status probe and the `/clis` list. */
function deckFetch(status: unknown = { available: true }, clis: unknown = CLIS_OK) {
  return vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/clis')) return jsonResponse(clis)
    return jsonResponse(status)
  }) as unknown as typeof fetch
}

/** A fetch where `/status` is OK but the `/clis` probe FAILS (HTTP 500). */
function clisFailingFetch() {
  return vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/clis')) return jsonResponse(null, false, 500)
    return jsonResponse({ available: true })
  }) as unknown as typeof fetch
}

const availableFetch = () => deckFetch()

/** An in-memory ack storage seeded as already-acknowledged (skips the gate). */
function ackedStorage(): AckStorage {
  const map = new Map<string, string>([[TERMINAL_ACK_KEY, '1']])
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

/** An in-memory ack storage that starts un-acknowledged (shows the gate). */
function freshStorage(): AckStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

/** A stand-in for the heavy xterm view so the route renders in jsdom. */
function StubView() {
  return <div data-testid="terminal-view">live terminal</div>
}

/**
 * A stub view that immediately exercises the lifted callbacks — it reports a
 * 'connected' status, hands a spy `clear` up, and counts its own mounts so a
 * Restart (key-driven remount) is observable.
 */
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

/** Click the launcher's "Raw shell" preset to reach the live view (the launcher
 *  is the new first screen after the acknowledge gate). */
async function launchRawShell() {
  const launch = await screen.findByRole('button', { name: /launch the raw shell/i })
  fireEvent.click(launch)
}

describe('TerminalRoute', () => {
  // The multi-view now persists its open sessions to localStorage (refresh-resume),
  // so clear it between tests to keep each launch deterministic (no carried-over tabs).
  beforeEach(() => {
    localStorage.clear()
  })

  it('mounts the terminal view after the user picks a launcher preset (already acknowledged)', async () => {
    const fetchImpl = deckFetch()
    renderRoute(
      <TerminalRoute fetchImpl={fetchImpl} viewComponent={StubView} ackStorage={ackedStorage()} />,
    )

    // The launcher (choose-your-agent) is shown first; the view mounts on select.
    await launchRawShell()
    expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
    // On loopback no token is saved, so the auth headers spread to empty.
    expect(fetchImpl).toHaveBeenCalledWith('/api/agent-deck/terminal/status', { headers: {} })
    // Onboarding tier: a plain-language subtitle that says what this is.
    expect(screen.getByText('A real shell on the host')).toBeInTheDocument()
  })

  it('shows the launcher (only installed CLIs actionable) before any session', async () => {
    renderRoute(
      <TerminalRoute
        fetchImpl={deckFetch()}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    // Installed → actionable; Claude is missing → muted with an install link.
    expect(await screen.findByRole('button', { name: /launch the hermes cli/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /launch the claude code/i })).toBeNull()
    expect(screen.getByRole('link', { name: /install/i })).toHaveAttribute(
      'href',
      'https://x/claude',
    )
    // No session yet.
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('does not get stuck on "Checking…" when the CLI probe fails (threads the failed phase)', async () => {
    renderRoute(
      <TerminalRoute
        fetchImpl={clisFailingFetch()}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    // The launcher must render the usable fallback (raw shell actionable), NOT
    // hang forever on the "Checking which CLIs are installed…" placeholder.
    expect(await screen.findByRole('button', { name: /launch the raw shell/i })).toBeEnabled()
    expect(screen.queryByText(/checking which clis/i)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't check which agent clis/i)
  })

  it('forwards the chosen preset id to the view as `cli`', async () => {
    const seenCli: string[] = []
    // Record the prop in an effect (not during render) to satisfy purity rules.
    function CapturingView({ cli }: TerminalViewProps) {
      useEffect(() => {
        seenCli.push(cli ?? '<none>')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid="terminal-view">live</div>
    }
    renderRoute(
      <TerminalRoute
        fetchImpl={deckFetch()}
        viewComponent={CapturingView}
        ackStorage={ackedStorage()}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /launch the hermes cli/i }))
    await screen.findByTestId('terminal-view')
    expect(seenCli).toContain('hermes')
  })

  it('shows an honest unavailable panel with the backend reason', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        available: false,
        cwd_available: false,
        reason: 'node-pty is not available on this host.',
      }),
    ) as unknown as typeof fetch
    renderRoute(<TerminalRoute fetchImpl={fetchImpl} viewComponent={StubView} />)

    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/not available on this host/i)).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('shows the calm no-workspace panel BEFORE the consent gate when cwd_available is false', async () => {
    // node-pty is fine (available:true) but there is no workspace cwd. The
    // doomed-spawn guard: the calm panel must render, and the scary real-shell
    // consent must NOT precede it — even though storage is un-acknowledged.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        available: true,
        cwd_available: false,
        reason: 'No workspace directory to open the terminal in.',
      }),
    ) as unknown as typeof fetch
    renderRoute(
      <TerminalRoute fetchImpl={fetchImpl} viewComponent={StubView} ackStorage={freshStorage()} />,
    )

    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/no workspace directory/i)).toBeInTheDocument()
    // The real-shell consent gate must NOT be shown (it would precede a doomed spawn).
    expect(
      screen.queryByRole('alertdialog', { name: /real shell warning/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('shows a reachability error when the status probe fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, false, 500)) as unknown as typeof fetch
    renderRoute(<TerminalRoute fetchImpl={fetchImpl} viewComponent={StubView} />)

    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/couldn't reach the terminal backend/i)).toBeInTheDocument()
  })

  it('renders the surface header', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ available: true }),
    ) as unknown as typeof fetch
    renderRoute(
      <TerminalRoute fetchImpl={fetchImpl} viewComponent={StubView} ackStorage={ackedStorage()} />,
    )
    expect(await screen.findByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
  })

  it('no longer discourages mobile use (the touch key bar replaced the warning note)', async () => {
    renderRoute(
      <TerminalRoute
        fetchImpl={availableFetch()}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    await screen.findByRole('heading', { name: 'Terminal' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.queryByText(/use a desktop/i)).not.toBeInTheDocument()
  })

  it('renders exactly ONE header for the surface (T1.8 — no double header)', async () => {
    renderRoute(
      <TerminalRoute
        fetchImpl={availableFetch()}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    expect(screen.getAllByRole('heading', { name: 'Terminal' })).toHaveLength(1)
  })

  it('folds the live connection status into the header actions (T1.8)', async () => {
    renderRoute(
      <TerminalRoute
        fetchImpl={availableFetch()}
        viewComponent={WiringStubView}
        ackStorage={ackedStorage()}
      />,
    )
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    // The stub reports 'connected'; the status indicator now lives in the header.
    expect(await screen.findByText('Connected')).toBeInTheDocument()
  })

  it('Clear button in the header invokes the engine clear handle (T2.3)', async () => {
    stubClear.mockClear()
    renderRoute(
      <TerminalRoute
        fetchImpl={availableFetch()}
        viewComponent={WiringStubView}
        ackStorage={ackedStorage()}
      />,
    )
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    const clear = await screen.findByRole('button', { name: /clear/i })
    await waitFor(() => expect(clear).not.toBeDisabled())
    fireEvent.click(clear)
    expect(stubClear).toHaveBeenCalledTimes(1)
  })

  it('Restart button remounts the view for an in-place reconnect (T2.3)', async () => {
    stubMounts = 0
    renderRoute(
      <TerminalRoute
        fetchImpl={availableFetch()}
        viewComponent={WiringStubView}
        ackStorage={ackedStorage()}
      />,
    )
    await launchRawShell()
    await screen.findByTestId('terminal-view')
    expect(stubMounts).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    await waitFor(() => expect(stubMounts).toBe(2))
  })

  it('resumes the persisted sessions on reload (mounts the multi-view, not the launcher)', async () => {
    // Simulate a prior visit: open sessions parked in localStorage under the key
    // the multi-view restores from. On reload `launchCli` is gone (in-memory only),
    // so the route must seed "live" from this persisted state and mount the
    // multi-view (which reattaches the parked pty + replays scrollback) — NOT the
    // launcher, which would orphan the parked shells.
    localStorage.setItem(
      TERMINAL_SESSIONS_KEY,
      JSON.stringify({
        sessions: [{ id: 'term-1-abc123', cli: 'shell', title: 'Shell 1', epoch: 0 }],
        activeId: 'term-1-abc123',
        viewMode: 'tab',
        seq: 1,
      }),
    )
    renderRoute(
      <TerminalRoute
        fetchImpl={availableFetch()}
        viewComponent={StubView}
        ackStorage={ackedStorage()}
      />,
    )
    // The live view mounts straight away — no launcher click needed.
    expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
    // The launcher's preset buttons must NOT be shown (we resumed, didn't relaunch).
    expect(screen.queryByRole('button', { name: /launch the raw shell/i })).toBeNull()
  })

  it('reattaches the SAME stable session id on reload (the reattach/resume path can fire)', async () => {
    // The reattach hinges on the client re-sending the SAME sessionId on reconnect
    // (terminalSocket re-`start`s with the stored sessionId). The multi-view derives
    // that wire id from the persisted session (id+epoch), so on resume the view must
    // receive the persisted session's stable id — proving the reattach path is wired.
    const seenSessionIds: string[] = []
    function CapturingView({ sessionId }: TerminalViewProps) {
      useEffect(() => {
        if (sessionId) seenSessionIds.push(sessionId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid="terminal-view">live</div>
    }
    localStorage.setItem(
      TERMINAL_SESSIONS_KEY,
      JSON.stringify({
        sessions: [{ id: 'term-7-zzz999', cli: 'shell', title: 'Shell 7', epoch: 3 }],
        activeId: 'term-7-zzz999',
        viewMode: 'tab',
        seq: 7,
      }),
    )
    renderRoute(
      <TerminalRoute
        fetchImpl={availableFetch()}
        viewComponent={CapturingView}
        ackStorage={ackedStorage()}
      />,
    )
    await screen.findByTestId('terminal-view')
    // The wire id folds id+epoch (see sessionKey) — the same key the parked pty is
    // keyed by, so the server REATTACHES rather than spawning a fresh shell.
    expect(seenSessionIds).toContain('term-7-zzz999:3')
  })

  describe('first-open real-shell acknowledge gate', () => {
    it('shows the real-shell warning and does NOT mount the view until acknowledged', async () => {
      renderRoute(
        <TerminalRoute
          fetchImpl={availableFetch()}
          viewComponent={WiringStubView}
          ackStorage={freshStorage()}
        />,
      )
      // Backend is available, but the view stays unmounted behind the gate.
      // Target the gate by its alertdialog role (the surface subtitle also
      // mentions a "real shell", so a phrase match would be ambiguous).
      const gate = await screen.findByRole('alertdialog', { name: /real shell warning/i })
      expect(gate).toBeInTheDocument()
      // Softened (warmer) copy, but the honest "no sandbox" fact + the
      // acknowledgment are KEPT (the gate is intentional).
      expect(within(gate).getByText(/a quick heads-up first/i)).toBeInTheDocument()
      expect(within(gate).getByText(/there's no sandbox/i)).toBeInTheDocument()
      expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
    })

    it('shows the launcher after the user acknowledges (then mounts on select)', async () => {
      renderRoute(
        <TerminalRoute
          fetchImpl={availableFetch()}
          viewComponent={StubView}
          ackStorage={freshStorage()}
        />,
      )
      const ack = await screen.findByRole('button', { name: /open the terminal/i })
      fireEvent.click(ack)
      // After the consent gate the launcher is shown (not the live view yet).
      await launchRawShell()
      expect(await screen.findByTestId('terminal-view')).toBeInTheDocument()
      expect(
        screen.queryByRole('alertdialog', { name: /real shell warning/i }),
      ).not.toBeInTheDocument()
    })

    it('does not gate when already acknowledged (returning visit goes to the launcher)', async () => {
      renderRoute(
        <TerminalRoute
          fetchImpl={availableFetch()}
          viewComponent={StubView}
          ackStorage={ackedStorage()}
        />,
      )
      // The launcher is shown directly (no consent gate on a returning visit).
      expect(
        await screen.findByRole('button', { name: /launch the raw shell/i }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('alertdialog', { name: /real shell warning/i }),
      ).not.toBeInTheDocument()
    })
  })

  describe('tmux persistence wiring', () => {
    /** A fetch answering status, clis, AND the tmux sessions list. */
    function tmuxFetch(sessions: unknown) {
      return vi.fn(async (url: string) => {
        if (typeof url === 'string' && url.includes('/clis')) return jsonResponse(CLIS_OK)
        if (typeof url === 'string' && url.includes('/sessions')) return jsonResponse(sessions)
        return jsonResponse({ available: true })
      }) as unknown as typeof fetch
    }

    it('the launcher says when shells cannot persist (no tmux on the host)', async () => {
      renderRoute(
        <TerminalRoute
          fetchImpl={tmuxFetch({ tmuxAvailable: false, sessions: [] })}
          viewComponent={StubView}
          ackStorage={ackedStorage()}
        />,
      )
      expect(
        await screen.findByText('Shells on this host are not persistent (tmux not installed).'),
      ).toBeInTheDocument()
    })

    it('recovers running deck shells from the launcher after browser data loss', async () => {
      // localStorage is empty (cleared in beforeEach) but the server still
      // holds a deck-owned session: the launcher offers Reattach, and choosing
      // it mounts the multi-view with the recovered tab (no fresh shell).
      renderRoute(
        <TerminalRoute
          fetchImpl={tmuxFetch({
            tmuxAvailable: true,
            sessions: [
              {
                name: 'adk_lost-1',
                deckOwned: true,
                attachedCount: 0,
                createdEpoch: 1765000000,
                lastActivityEpoch: 1765000100,
                persistent: true,
              },
            ],
          })}
          viewComponent={StubView}
          ackStorage={ackedStorage()}
        />,
      )
      fireEvent.click(await screen.findByRole('button', { name: /reattach/i }))
      expect(await screen.findByRole('tab', { name: /lost-1/i })).toBeInTheDocument()
      expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)
    })

    it('attaches to a foreign tmux session from the launcher', async () => {
      const seenAttach: string[] = []
      function CapturingView({ attach }: TerminalViewProps) {
        useEffect(() => {
          if (attach) seenAttach.push(attach)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])
        return <div data-testid="terminal-view">live</div>
      }
      renderRoute(
        <TerminalRoute
          fetchImpl={tmuxFetch({
            tmuxAvailable: true,
            sessions: [
              {
                name: 'victors_own',
                deckOwned: false,
                attachedCount: 1,
                createdEpoch: 1765000000,
                lastActivityEpoch: 1765000100,
                persistent: true,
              },
            ],
          })}
          viewComponent={CapturingView}
          ackStorage={ackedStorage()}
        />,
      )
      fireEvent.click(await screen.findByRole('button', { name: /attach to victors_own/i }))
      await screen.findByTestId('terminal-view')
      expect(seenAttach).toContain('victors_own')
    })
  })
})
