import { describe, it, expect, beforeEach } from 'vitest'
import { useEffect, useState, type ComponentType } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PaneGrid, type GridPane } from './PaneGrid'
import {
  addPane,
  emptyWorkspace,
  paneSessionId,
  removePane,
  renamePane,
  restartPane,
  setActivePane,
  setPaneCwd,
  setViewMode,
  type WorkspaceState,
} from './terminalWorkspaces'
import type { DetectedCli } from './useTerminalClis'
import type { TerminalViewProps } from './TerminalView'

/**
 * PaneGrid is the SINGLE grid engine for both Scratch and saved workspaces. It is
 * CONTROLLED: its caller owns the normalized pane list + active id + view mode.
 * These tests wrap it in a harness backed by the pure workspace reducers (the
 * same shape both controllers use), with an injected stub view that records each
 * mount's props and exercises the lifted callbacks. This file consolidates the
 * coverage that lived in the old TerminalMultiView.test + WorkspaceMultiView.test:
 * tabs/grid, the cap, persistence badges, the honest close/restart confirm
 * dialogs, foreign-attach detach, per-pane cwd reaching the start payload, and the
 * restart-kills-persistent-first ordering.
 */

/** Map a WorkspaceState into the grid's normalized panes (mirrors the controllers). */
function toGridPanes(s: WorkspaceState): GridPane[] {
  return s.panes.map((p) => ({
    id: p.id,
    label: p.label,
    wireId: paneSessionId(s.id, p.id, p.epoch),
    ...(p.cli !== undefined ? { cli: p.cli } : {}),
    ...(p.cwd !== undefined ? { cwd: p.cwd } : {}),
    ...(p.attach !== undefined ? { attach: p.attach } : {}),
  }))
}

/** A controlled harness around PaneGrid using the real pure workspace reducers. */
function Harness({
  initial,
  viewComponent,
  showLayoutPresets,
}: {
  initial: WorkspaceState
  viewComponent: ComponentType<TerminalViewProps>
  showLayoutPresets?: boolean
}) {
  const [state, setState] = useState<WorkspaceState>(initial)
  return (
    <PaneGrid
      panes={toGridPanes(state)}
      activeId={state.activePane}
      viewMode={state.viewMode}
      viewComponent={viewComponent}
      showLayoutPresets={showLayoutPresets}
      tablistLabel="Terminals"
      gridLabel="Terminal grid"
      addLabel="New terminal"
      addMenuLabel="New terminal preset"
      capNoun="terminals"
      onAddPane={(cli) => setState((s) => addPane(s, cli))}
      onRemovePane={(id) => setState((s) => removePane(s, id))}
      onRenamePane={(id, label) => setState((s) => renamePane(s, id, label))}
      onRestartPane={(id) => setState((s) => restartPane(s, id))}
      onActivatePane={(id) => setState((s) => setActivePane(s, id))}
      onSetViewMode={(mode) => setState((s) => setViewMode(s, mode))}
      onApplyLayout={() => {}}
    />
  )
}

/** A one-pane workspace at the given view mode (grid exposes per-cell Restart). */
function oneShell(view: 'tab' | 'grid' = 'tab'): WorkspaceState {
  return addPane(emptyWorkspace('w1', 'Scratch', view), 'shell')
}

/** Open another pane via the "+" preset menu (choosing the raw shell). */
function openAnotherShell() {
  fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /raw shell/i }))
}

describe('PaneGrid (the unified grid engine)', () => {
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

  beforeEach(() => {
    mounts.length = 0
    localStorage.clear()
  })

  it('opens with one live pane for the chosen preset', () => {
    let s = emptyWorkspace('w1', 'Scratch')
    s = addPane(s, 'hermes')
    render(<Harness initial={s} viewComponent={StubView} />)
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.cli).toBe('hermes')
  })

  it('the "+" opens another pane (tab view shows one active at a time)', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    openAnotherShell()
    expect(mounts).toHaveLength(2)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('switching tabs changes which pane is selected', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    openAnotherShell()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[1]!).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(tabs[0]!)
    expect(screen.getAllByRole('tab')[0]!).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')[1]!).toHaveAttribute('aria-selected', 'false')
  })

  it('closing a (volatile) tab removes its pane', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    openAnotherShell()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    const firstTab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(firstTab).getByRole('button', { name: /close/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('keeps dense controls touch-sized before desktop compaction', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
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
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    const grid = screen.getByRole('group', { name: /terminal grid/i })
    const restart = within(grid).getByRole('button', { name: /restart/i })
    expect(restart.className).toContain('size-11')
    expect(restart.className).toContain('md:size-7')
  })

  it('toggles between tab and grid view modes', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    openAnotherShell()
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    const grid = screen.getByRole('group', { name: /terminal grid/i })
    expect(within(grid).getAllByTestId('terminal-view')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /tab view/i }))
    expect(screen.queryByRole('group', { name: /terminal grid/i })).not.toBeInTheDocument()
  })

  it('grid marks the focused pane as the live/active one', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    openAnotherShell()
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    const grid = screen.getByRole('group', { name: /terminal grid/i })
    const current = within(grid)
      .getAllByRole('group')
      .filter((el) => el.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(1)
  })

  it('renames a tab via its rename control', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.dblClick(tab)
    const input = screen.getByRole('textbox', { name: /rename pane/i })
    fireEvent.change(input, { target: { value: 'logs' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('tab', { name: /logs/i })).toBeInTheDocument()
  })

  it('renames a tab via the F2 keyboard shortcut (a11y, no mouse needed)', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    const tab = screen.getAllByRole('tab')[0]!
    tab.focus()
    fireEvent.keyDown(tab, { key: 'F2' })
    const input = screen.getByRole('textbox', { name: /rename pane/i })
    fireEvent.change(input, { target: { value: 'logs' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('tab', { name: /logs/i })).toBeInTheDocument()
  })

  it('enforces the 12-pane cap with an honest disabled "+" + max note', () => {
    render(<Harness initial={oneShell()} viewComponent={StubView} />)
    for (let i = 0; i < 11; i += 1) openAnotherShell()
    expect(screen.getAllByRole('tab')).toHaveLength(12)
    expect(screen.getByRole('button', { name: /new terminal/i })).toBeDisabled()
    expect(screen.getByText(/all 12 terminals|maximum/i)).toBeInTheDocument()
  })

  describe('the "+" preset menu', () => {
    const clis: DetectedCli[] = [
      { id: 'hermes', label: 'Hermes CLI', available: true },
      { id: 'claude', label: 'Claude Code', available: false },
      { id: 'codex', label: 'Codex', available: true },
      { id: 'shell', label: 'Raw shell', available: true },
    ]

    function renderWith(clisArg?: DetectedCli[]) {
      render(
        <PaneGrid
          panes={[]}
          activeId={null}
          viewMode="tab"
          clis={clisArg}
          viewComponent={StubView}
          addLabel="New terminal"
          addMenuLabel="New terminal preset"
          onAddPane={() => {}}
          onRemovePane={() => {}}
          onRenamePane={() => {}}
          onRestartPane={() => {}}
          onActivatePane={() => {}}
          onSetViewMode={() => {}}
        />,
      )
    }

    it('opens a preset menu with only installed presets actionable', () => {
      renderWith(clis)
      expect(screen.queryByRole('menu', { name: /new terminal preset/i })).toBeNull()
      // The empty state renders its own "+" too; target the bar one by its label.
      fireEvent.click(screen.getAllByRole('button', { name: /new terminal/i })[0]!)
      const menu = screen.getByRole('menu', { name: /new terminal preset/i })
      expect(within(menu).getByRole('menuitem', { name: /hermes/i })).toBeEnabled()
      expect(within(menu).getByRole('menuitem', { name: /raw shell/i })).toBeEnabled()
      expect(within(menu).getByRole('menuitem', { name: /claude/i })).toBeDisabled()
    })

    it('always offers the raw shell even when the CLI list is unknown', () => {
      renderWith()
      fireEvent.click(screen.getAllByRole('button', { name: /new terminal/i })[0]!)
      const menu = screen.getByRole('menu', { name: /new terminal preset/i })
      expect(within(menu).getByRole('menuitem', { name: /raw shell/i })).toBeEnabled()
      expect(within(menu).getByRole('menuitem', { name: /hermes/i })).toBeDisabled()
    })

    it('closes the preset menu on Escape', () => {
      renderWith(clis)
      fireEvent.click(screen.getAllByRole('button', { name: /new terminal/i })[0]!)
      expect(screen.getByRole('menu', { name: /new terminal preset/i })).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu', { name: /new terminal preset/i })).toBeNull()
    })
  })

  it('shows the layout-preset menu only when enabled (saved workspaces)', () => {
    const { rerender } = render(<Harness initial={oneShell()} viewComponent={StubView} />)
    expect(screen.queryByRole('button', { name: /^layout$/i })).toBeNull()
    rerender(<Harness initial={oneShell()} viewComponent={StubView} showLayoutPresets />)
    expect(screen.getByRole('button', { name: /^layout$/i })).toBeInTheDocument()
  })
})

/* -- Per-pane cwd reaches the start payload (from WorkspaceMultiView.test) ---- */

describe('PaneGrid per-pane cwd', () => {
  const mounts: Array<{ cli?: string; cwd?: string; sessionId?: string }> = []
  function RecordingStub({ cli, cwd, sessionId, onStatusChange }: TerminalViewProps) {
    useEffect(() => {
      mounts.push({ cli, cwd, sessionId })
      onStatusChange?.('connected')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="terminal-view">{cwd ?? cli}</div>
  }

  beforeEach(() => {
    mounts.length = 0
    localStorage.clear()
  })

  it('forwards a pane cwd to the view it mounts (cwd reaches terminal.start)', () => {
    let s = emptyWorkspace('w1', 'Alpha')
    s = addPane(s, 'shell')
    const paneId = s.panes[0]!.id
    s = setPaneCwd(s, paneId, '/home/operator/Projects')
    render(<Harness initial={s} viewComponent={RecordingStub} />)
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.cwd).toBe('/home/operator/Projects')
    // The deterministic sessionId is also forwarded alongside the cwd.
    expect(mounts[0]!.sessionId).toBe(`ws_w1_${paneId}`)
  })

  it('omits cwd for a pane with none (the server default cwd applies)', () => {
    let s = emptyWorkspace('w1', 'Alpha')
    s = addPane(s, 'shell')
    render(<Harness initial={s} viewComponent={RecordingStub} />)
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.cwd).toBeUndefined()
  })
})

/* -- Persistence badges + honest close/restart confirms ---------------------- */

describe('PaneGrid persistence + honest close/restart', () => {
  const closeCalls: string[] = []

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
    closeCalls.length = 0
    localStorage.clear()
  })

  it('shows a persistent badge when the shell is tmux-backed', () => {
    render(<Harness initial={oneShell()} viewComponent={persistenceStub(true)} />)
    expect(screen.getByText('persistent')).toBeInTheDocument()
    expect(screen.queryByText('volatile')).toBeNull()
  })

  it('shows a volatile badge when the shell is not tmux-backed', () => {
    render(<Harness initial={oneShell()} viewComponent={persistenceStub(false)} />)
    expect(screen.getByText('volatile')).toBeInTheDocument()
  })

  it('closing a PERSISTENT shell asks first, then ends it for real', () => {
    render(<Harness initial={oneShell()} viewComponent={persistenceStub(true)} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    expect(screen.getByText(/ends the persistent shell/i)).toBeInTheDocument()
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^close terminal$/i }))
    expect(closeCalls).toHaveLength(1)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('Cancel keeps the persistent shell (no close sent)', () => {
    render(<Harness initial={oneShell()} viewComponent={persistenceStub(true)} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('closing a VOLATILE shell needs no confirm', () => {
    render(<Harness initial={oneShell()} viewComponent={persistenceStub(false)} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    expect(screen.queryByText(/ends the persistent shell/i)).toBeNull()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
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

  it('closing a shell with UNKNOWN persistence asks first, never a silent volatile close', () => {
    render(<Harness initial={oneShell()} viewComponent={UnknownPersistenceStub} />)
    const tab = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(tab).getByRole('button', { name: /close/i }))
    expect(screen.getByText(/has not connected yet, so it may be persistent/i)).toBeInTheDocument()
    expect(closeCalls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /^close terminal$/i }))
    expect(closeCalls).toHaveLength(1)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('a FOREIGN attach tab detaches (never a kill confirm), labeled honestly', () => {
    const s: WorkspaceState = {
      ...emptyWorkspace('w1', 'Scratch', 'tab'),
      panes: [{ id: 'p1', label: 'my_session', attach: 'my_session', epoch: 0 }],
      activePane: 'p1',
    }
    render(<Harness initial={s} viewComponent={persistenceStub(true)} />)
    const tab = screen.getByRole('tab', { name: /my_session/i })
    const detach = within(tab).getByRole('button', { name: /detach my_session/i })
    fireEvent.click(detach)
    expect(screen.queryByText(/ends the persistent shell/i)).toBeNull()
    expect(closeCalls).toEqual(['my_session'])
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('restarting a PERSISTENT shell asks first, then kills the old tmux session and remounts fresh', () => {
    const s = oneShell('grid')
    const paneId = s.panes[0]!.id
    render(<Harness initial={s} viewComponent={persistenceStub(true)} />)
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    expect(screen.getByText(/the current shell ends for real/i)).toBeInTheDocument()
    expect(closeCalls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /^restart terminal$/i }))
    // The OLD (epoch-0) shell was killed before the fresh one mounted.
    expect(closeCalls).toEqual([`ws_w1_${paneId}`])
  })

  it('Cancel keeps the persistent shell running (no restart, no close sent)', () => {
    render(<Harness initial={oneShell('grid')} viewComponent={persistenceStub(true)} />)
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closeCalls).toHaveLength(0)
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)
  })

  it('restarting a VOLATILE shell stays a plain epoch bump (no terminal.close)', () => {
    const s = oneShell('grid')
    const paneId = s.panes[0]!.id
    render(<Harness initial={s} viewComponent={persistenceStub(false)} />)
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    expect(closeCalls).toHaveLength(0)
    // The fresh shell still started (epoch bumped to 1).
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    expect(paneId).toBeTruthy()
  })

  it("restarting a FOREIGN attach tab never kills the user's own session", () => {
    const s: WorkspaceState = {
      ...emptyWorkspace('w1', 'Scratch', 'grid'),
      panes: [{ id: 'p1', label: 'my_session', attach: 'my_session', epoch: 0 }],
      activePane: 'p1',
    }
    render(<Harness initial={s} viewComponent={persistenceStub(true)} />)
    fireEvent.click(screen.getByRole('button', { name: /^restart/i }))
    expect(closeCalls).toHaveLength(0)
  })
})
