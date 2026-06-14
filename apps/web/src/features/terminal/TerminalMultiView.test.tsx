import { describe, it, expect, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TerminalMultiView } from './TerminalMultiView'
import {
  TERMINAL_VIEW_MODE_KEY,
  emptySessions,
  expectedTmuxName,
  openSession,
  writeSessions,
} from './terminalSessions'
import type { DetectedCli } from './useTerminalClis'
import type { TerminalViewProps } from './TerminalView'

/**
 * A lightweight stand-in for the heavy xterm view. It records each mount with its
 * `cli` prop so we can assert how many live terminals exist and which preset they
 * carry, and reports a 'connected' status so the host's per-session affordances
 * light up. Reports VOLATILE persistence (like a ready frame on a no-tmux host)
 * so the legacy direct-close behavior applies; the persistence describe below
 * covers the persistent/unknown close paths.
 */
const mounts: Array<{ cli?: string }> = []
function StubView({ cli, onStatusChange, onPersistentChange }: TerminalViewProps) {
  useEffect(() => {
    mounts.push({ cli })
    onStatusChange?.('connected')
    onPersistentChange?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div data-testid="terminal-view">{cli ?? 'shell'}</div>
}

function renderMulti(initialCli: 'hermes' | 'shell' = 'shell', clis?: DetectedCli[]) {
  mounts.length = 0
  return render(<TerminalMultiView initialCli={initialCli} clis={clis} viewComponent={StubView} />)
}

/** Open another terminal via the "+" preset menu, choosing the raw shell (the
 *  always-available default). Mirrors the user flow now the "+" opens a menu. */
function openAnotherShell() {
  fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /raw shell/i }))
}

describe('TerminalMultiView', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opens with one live terminal for the chosen preset', () => {
    renderMulti('hermes')
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.cli).toBe('hermes')
  })

  it('the "+" opens another terminal (tab view shows one active at a time)', () => {
    renderMulti('shell')
    openAnotherShell()
    // Two sessions exist (two mounted views), but only the active one is visible.
    expect(mounts).toHaveLength(2)
    // Two tabs are present.
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('switching tabs changes which terminal is selected', () => {
    renderMulti('shell')
    openAnotherShell()
    const tabs = screen.getAllByRole('tab')
    // The newest tab is selected; click the first to switch.
    expect(tabs[1]!).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(tabs[0]!)
    expect(tabs[0]!).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]!).toHaveAttribute('aria-selected', 'false')
  })

  it('closing a tab removes its terminal', () => {
    renderMulti('shell')
    openAnotherShell()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    // Close the first tab via its close control.
    const firstTab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(firstTab).getByRole('button', { name: /close/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('keeps dense terminal controls touch-sized before desktop compaction', () => {
    renderMulti('shell')

    expect(screen.getByRole('button', { name: /new terminal/i }).className).toContain('size-11')
    expect(screen.getByRole('button', { name: /tab view/i }).className).toContain('h-11')
    expect(screen.getByRole('button', { name: /grid view/i }).className).toContain('min-w-11')

    const tab = screen.getAllByRole('tab')[0]!
    expect(tab.className).toContain('h-11')
    expect(tab.className).toContain('md:h-10')
    const close = within(tab).getByRole('button', { name: /close/i })
    expect(close.className).toContain('size-11')
    expect(close.className).toContain('md:size-7')
  })

  it('keeps grid restart controls touch-sized before desktop compaction', () => {
    renderMulti('shell')
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    const grid = screen.getByRole('group', { name: /terminal grid/i })
    const restart = within(grid).getByRole('button', { name: /restart/i })
    expect(restart.className).toContain('size-11')
    expect(restart.className).toContain('md:size-7')
  })

  it('toggles between tab and grid view modes', () => {
    renderMulti('shell')
    openAnotherShell()
    // Switch to grid: both terminals are visible at once.
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    const grid = screen.getByRole('group', { name: /terminal grid/i })
    expect(within(grid).getAllByTestId('terminal-view')).toHaveLength(2)
    // Back to tab view.
    fireEvent.click(screen.getByRole('button', { name: /tab view/i }))
    expect(screen.queryByRole('group', { name: /terminal grid/i })).not.toBeInTheDocument()
  })

  it('persists the view mode to localStorage and restores it on remount (P2)', () => {
    const { unmount } = renderMulti('shell')
    // Switch to grid → it should be written to storage.
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    expect(localStorage.getItem(TERMINAL_VIEW_MODE_KEY)).toBe('grid')
    unmount()
    // A fresh mount (simulating a reload) restores the grid layout.
    renderMulti('shell')
    expect(screen.getByRole('group', { name: /terminal grid/i })).toBeInTheDocument()
  })

  describe('the "+" new-terminal preset menu (P2)', () => {
    const clis: DetectedCli[] = [
      { id: 'hermes', label: 'Hermes CLI', available: true },
      { id: 'claude', label: 'Claude Code', available: false },
      { id: 'codex', label: 'Codex', available: true },
      { id: 'shell', label: 'Raw shell', available: true },
    ]

    it('opens a preset menu instead of being hardwired to shell', () => {
      renderMulti('shell', clis)
      // No menu until the "+" is pressed.
      expect(screen.queryByRole('menu', { name: /new terminal preset/i })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
      const menu = screen.getByRole('menu', { name: /new terminal preset/i })
      // Installed presets are actionable; a missing one is disabled (honest).
      expect(within(menu).getByRole('menuitem', { name: /hermes/i })).toBeEnabled()
      expect(within(menu).getByRole('menuitem', { name: /raw shell/i })).toBeEnabled()
      expect(within(menu).getByRole('menuitem', { name: /claude/i })).toBeDisabled()
    })

    it('opens a new terminal for the chosen preset (not just shell)', () => {
      renderMulti('shell', clis)
      fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: /hermes/i }))
      // A second terminal mounted, seeded with the hermes preset.
      expect(mounts).toHaveLength(2)
      expect(mounts[1]!.cli).toBe('hermes')
      // The menu closes after a choice.
      expect(screen.queryByRole('menu', { name: /new terminal preset/i })).toBeNull()
    })

    it('always offers the raw shell even when the CLI list is unknown', () => {
      renderMulti('shell') // no clis prop
      fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
      const menu = screen.getByRole('menu', { name: /new terminal preset/i })
      expect(within(menu).getByRole('menuitem', { name: /raw shell/i })).toBeEnabled()
      // Unconfirmed agent CLIs are not actionable until detected.
      expect(within(menu).getByRole('menuitem', { name: /hermes/i })).toBeDisabled()
    })

    it('closes the preset menu on Escape', () => {
      renderMulti('shell', clis)
      fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
      expect(screen.getByRole('menu', { name: /new terminal preset/i })).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu', { name: /new terminal preset/i })).toBeNull()
    })
  })

  it('enforces the 12-terminal cap with an honest disabled "+" + max note', () => {
    renderMulti('shell')
    // Open until the cap (already 1 open → 11 more) via the "+" preset menu.
    for (let i = 0; i < 11; i += 1) openAnotherShell()
    expect(screen.getAllByRole('tab')).toHaveLength(12)
    // The "+" is now disabled and the surface says the max is reached.
    expect(screen.getByRole('button', { name: /new terminal/i })).toBeDisabled()
    expect(screen.getByText(/max(imum)?|all 12|reached/i)).toBeInTheDocument()
  })

  it('grid marks the focused terminal as the live/active one', () => {
    renderMulti('shell')
    openAnotherShell()
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    const grid = screen.getByRole('group', { name: /terminal grid/i })
    // Each grid cell is a focusable region; exactly one is marked current.
    const current = within(grid)
      .getAllByRole('group')
      .filter((el) => el.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(1)
  })

  it('restores the open sessions on remount so a refresh resumes the same shells', () => {
    // Open a second terminal, then simulate a browser refresh (unmount + remount).
    const { unmount } = renderMulti('hermes')
    openAnotherShell()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    unmount()
    // A fresh mount restores BOTH tabs (not just the launcher's single initial one).
    renderMulti('hermes')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('renames a tab via its rename control', () => {
    renderMulti('shell')
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.dblClick(tab)
    const input = screen.getByRole('textbox', { name: /rename terminal/i })
    fireEvent.change(input, { target: { value: 'logs' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('tab', { name: /logs/i })).toBeInTheDocument()
  })
})

/* ── Persistence badges, honest close affordances, and server reconcile ──────── */

describe('TerminalMultiView persistence', () => {
  /** What each mounted view's explicit end-session handle was called with. */
  const closeCalls: string[] = []

  /** A stub view that reports a fixed persistence + records terminal.close. */
  function persistenceStub(persistent: boolean) {
    return function Stub({
      cli,
      sessionId,
      attach,
      onStatusChange,
      onPersistentChange,
      onCloseSessionReady,
    }: TerminalViewProps) {
      useEffect(() => {
        onStatusChange?.('connected')
        onPersistentChange?.(persistent)
        onCloseSessionReady?.(() => closeCalls.push(attach ?? sessionId ?? '?'))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid="terminal-view">{attach ?? cli}</div>
    }
  }

  beforeEach(() => {
    localStorage.clear()
    closeCalls.length = 0
  })

  it('shows a persistent badge when the shell is tmux-backed', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(true)} />)
    expect(screen.getByText('persistent')).toBeInTheDocument()
    expect(screen.queryByText('volatile')).toBeNull()
  })

  it('shows a volatile badge when the shell is not tmux-backed', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(false)} />)
    expect(screen.getByText('volatile')).toBeInTheDocument()
  })

  it('closing a PERSISTENT shell asks first, then ends it for real', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(true)} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    // The confirm dialog is up; nothing has been closed yet. (The dialog
    // aria-hides the page behind it, so the tab query opts into hidden nodes.)
    expect(screen.getByText(/ends the persistent shell/i)).toBeInTheDocument()
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1)
    // Confirm: terminal.close fires (kills the tmux session) and the tab goes.
    fireEvent.click(screen.getByRole('button', { name: /^close terminal$/i }))
    expect(closeCalls).toHaveLength(1)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('Cancel keeps the persistent shell (no close sent)', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(true)} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('closing a VOLATILE shell needs no confirm (current behavior)', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(false)} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    expect(screen.queryByText(/ends the persistent shell/i)).toBeNull()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    // No explicit terminal.close: the socket teardown ends a volatile shell.
    expect(closeCalls).toHaveLength(0)
  })

  /** A stub whose ready frame never arrives: persistence stays UNKNOWN. */
  function UnknownPersistenceStub({
    cli,
    sessionId,
    onStatusChange,
    onCloseSessionReady,
  }: TerminalViewProps) {
    useEffect(() => {
      onStatusChange?.('connecting')
      onCloseSessionReady?.(() => closeCalls.push(sessionId ?? '?'))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="terminal-view">{cli}</div>
  }

  it('closing a shell with UNKNOWN persistence (no ready yet) asks first, never a silent volatile close', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={UnknownPersistenceStub} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    // The confirm acknowledges the uncertainty instead of assuming volatile.
    expect(screen.getByText(/has not connected yet, so it may be persistent/i)).toBeInTheDocument()
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1)
    // Confirm: terminal.close fires for real (no orphaned adk_ tmux session).
    fireEvent.click(screen.getByRole('button', { name: /^close terminal$/i }))
    expect(closeCalls).toHaveLength(1)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('Cancel keeps the unknown-persistence shell open', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={UnknownPersistenceStub} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('a FOREIGN attach tab detaches (never a kill confirm), labeled honestly', () => {
    render(
      <TerminalMultiView
        initialCli="shell"
        initialAttach="victors_own"
        viewComponent={persistenceStub(true)}
      />,
    )
    // The tab carries the tmux session's name and a Detach affordance.
    const tab = screen.getByRole('tab', { name: /victors_own/i })
    const detach = within(tab).getByRole('button', { name: /detach victors_own/i })
    fireEvent.click(detach)
    // No confirm dialog: a detach is safe (the user's session keeps running).
    expect(screen.queryByText(/ends the persistent shell/i)).toBeNull()
    // terminal.close was sent (the server detaches a foreign session).
    expect(closeCalls).toEqual(['victors_own'])
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('restarting a PERSISTENT shell asks first, then kills the old tmux session (terminal.close) and remounts fresh', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(true)} />)
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    // The confirm dialog is up; nothing has been killed yet (a restart ends the
    // persistent shell for real, so it asks like Close does).
    expect(screen.getByText(/the current shell ends for real/i)).toBeInTheDocument()
    expect(closeCalls).toHaveLength(0)
    // Confirm: the old persistent shell is ended for real — a bare epoch bump
    // would have left it alive in the tmux server as recoverable cruft.
    fireEvent.click(screen.getByRole('button', { name: /^restart terminal$/i }))
    expect(closeCalls).toHaveLength(1)
    expect(closeCalls[0]).toMatch(/:0$/) // the epoch-0 wire key (the OLD shell)
    // The remounted view registered a NEW close handle under the bumped key.
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    fireEvent.click(screen.getByRole('button', { name: /^restart terminal$/i }))
    expect(closeCalls).toHaveLength(2)
    expect(closeCalls[1]).toMatch(/:1$/)
  })

  it('Cancel keeps the persistent shell running (no restart, no close sent)', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(true)} />)
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)
  })

  it('restarting a VOLATILE shell stays a plain epoch bump (no terminal.close)', () => {
    render(<TerminalMultiView initialCli="shell" viewComponent={persistenceStub(false)} />)
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    // The socket teardown ends a volatile shell; no explicit kill is sent.
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)
  })

  it("restarting a FOREIGN attach tab never kills the user's own session", () => {
    render(
      <TerminalMultiView
        initialCli="shell"
        initialAttach="victors_own"
        viewComponent={persistenceStub(true)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    expect(closeCalls).toHaveLength(0)
  })

  it('reconciles restored sessions against the server list (clean + recover)', () => {
    // Two sessions persisted from a previous load...
    let prior = openSession(emptySessions(), 'shell')
    prior = openSession(prior, 'hermes')
    writeSessions(prior)
    const survivor = prior.sessions[1]!
    // ...but the server only still holds the second one, plus a deck session
    // this browser forgot entirely.
    render(
      <TerminalMultiView
        initialCli="shell"
        viewComponent={persistenceStub(true)}
        serverSessions={{
          tmuxAvailable: true,
          sessions: [
            { name: expectedTmuxName(survivor), deckOwned: true },
            { name: 'adk_forgotten-7', deckOwned: true },
            { name: 'victors_own', deckOwned: false },
          ],
        }}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    // The dead entry is gone; the survivor + the recovered tab remain. The
    // foreign session is NOT auto-opened (attach is a launcher choice).
    expect(screen.getByRole('tab', { name: /forgotten-7/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /victors_own/i })).toBeNull()
  })

  it('without tmux the restored sessions are untouched (volatile behavior)', () => {
    let prior = openSession(emptySessions(), 'shell')
    prior = openSession(prior, 'hermes')
    writeSessions(prior)
    render(
      <TerminalMultiView
        initialCli="shell"
        viewComponent={persistenceStub(false)}
        serverSessions={{ tmuxAvailable: false, sessions: [] }}
      />,
    )
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('recoverOnly mounts only the server-recovered sessions (no fresh shell)', () => {
    render(
      <TerminalMultiView
        initialCli="shell"
        recoverOnly
        viewComponent={persistenceStub(true)}
        serverSessions={{
          tmuxAvailable: true,
          sessions: [{ name: 'adk_lost-1', deckOwned: true }],
        }}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /lost-1/i })).toBeInTheDocument()
  })

  /* ── expectResume plumbing (the fresh-shell honesty signal) ────────────────── */

  const resumeMounts: Array<{ cli?: string; expectResume?: boolean }> = []
  function ResumeRecordingStub({ cli, expectResume, onStatusChange }: TerminalViewProps) {
    useEffect(() => {
      resumeMounts.push({ cli, expectResume })
      onStatusChange?.('connected')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="terminal-view">{cli}</div>
  }

  it('a RESTORED session mounts expecting a resume; a fresh "+" open does not', () => {
    resumeMounts.length = 0
    writeSessions(openSession(emptySessions(), 'shell'))
    render(<TerminalMultiView initialCli="shell" viewComponent={ResumeRecordingStub} />)
    expect(resumeMounts).toHaveLength(1)
    expect(resumeMounts[0]!.expectResume).toBe(true)
    // A brand-new terminal opened now must NOT expect a resume (no false notice).
    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /raw shell/i }))
    expect(resumeMounts).toHaveLength(2)
    expect(resumeMounts[1]!.expectResume).toBe(false)
  })

  it('a server-RECOVERED session mounts expecting a resume', () => {
    resumeMounts.length = 0
    render(
      <TerminalMultiView
        initialCli="shell"
        recoverOnly
        viewComponent={ResumeRecordingStub}
        serverSessions={{
          tmuxAvailable: true,
          sessions: [{ name: 'adk_lost-2', deckOwned: true }],
        }}
      />,
    )
    expect(resumeMounts).toHaveLength(1)
    expect(resumeMounts[0]!.expectResume).toBe(true)
  })
})
