import { describe, it, expect, beforeEach } from 'vitest'
import { useEffect, useState, type ComponentType } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceMultiView } from './WorkspaceMultiView'
import {
  addPane,
  emptyWorkspace,
  removePane,
  restartPane,
  setActivePane,
  setViewMode,
  type WorkspaceState,
} from './terminalWorkspaces'
import type { TerminalViewProps } from './TerminalView'

/**
 * WorkspaceMultiView is CONTROLLED: the route owns the {@link WorkspaceState} and
 * the pure reducers. These tests wrap it in a tiny harness that holds the state
 * and applies the same reducers on the action callbacks (mirroring WorkspaceRoute),
 * with an injected stub view so we never touch the real xterm engine. The stub
 * records each mount's props (so we can assert the per-pane `cwd` reaches the
 * start payload) and its terminal.close handle (so we can assert a persistent
 * pane's old shell is killed before a restart's fresh shell starts).
 */

/** A controlled harness around WorkspaceMultiView using the real pure reducers. */
function Harness({
  initial,
  viewComponent,
}: {
  initial: WorkspaceState
  viewComponent: ComponentType<TerminalViewProps>
}) {
  const [state, setState] = useState<WorkspaceState>(initial)
  return (
    <WorkspaceMultiView
      state={state}
      viewComponent={viewComponent}
      onAddPane={(cli) => setState((s) => addPane(s, cli))}
      onRemovePane={(id) => setState((s) => removePane(s, id))}
      onRenamePane={() => {}}
      onRestartPane={(id) => setState((s) => restartPane(s, id))}
      onActivatePane={(id) => setState((s) => setActivePane(s, id))}
      onSetViewMode={(mode) => setState((s) => setViewMode(s, mode))}
      onApplyLayout={() => {}}
    />
  )
}

/* ── (issue 1) per-pane cwd reaches the start payload ─────────────────────────── */

describe('WorkspaceMultiView per-pane cwd', () => {
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
    // A workspace with one pane that has a picked cwd.
    let s = emptyWorkspace('w1', 'Alpha')
    s = addPane(s, 'shell')
    const paneId = s.panes[0]!.id
    s = { ...s, panes: s.panes.map((p) => ({ ...p, cwd: '/home/wonny/Projects' })) }

    render(<Harness initial={s} viewComponent={RecordingStub} />)

    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.cwd).toBe('/home/wonny/Projects')
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

/* ── (issue 2) restart kills a persistent pane's old tmux session first ───────── */

describe('WorkspaceMultiView restart of a persistent pane', () => {
  /** Every sessionId a view's terminal.close handle was fired with, in order. */
  const closeCalls: string[] = []
  /** Every sessionId mounted, in order (so we can see the fresh shell start). */
  const mountedIds: string[] = []

  /** A stub view reporting a fixed persistence and recording terminal.close. */
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
        mountedIds.push(sessionId ?? attach ?? '?')
        onStatusChange?.('connected')
        onPersistentChange?.(persistent)
        onCloseSessionReady?.(() => closeCalls.push(sessionId ?? attach ?? '?'))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid="terminal-view">{attach ?? cli}</div>
    }
  }

  /** A one-pane grid-view workspace (grid exposes a per-cell Restart button). */
  function oneShellGrid(): WorkspaceState {
    let s = emptyWorkspace('w1', 'Alpha', 'grid')
    s = addPane(s, 'shell')
    return s
  }

  beforeEach(() => {
    closeCalls.length = 0
    mountedIds.length = 0
    localStorage.clear()
  })

  it('kills the old tmux session (terminal.close) BEFORE the epoch-bumped shell starts', () => {
    const s = oneShellGrid()
    const paneId = s.panes[0]!.id
    render(<Harness initial={s} viewComponent={persistenceStub(true)} />)

    // One shell mounted at epoch 0 (the bare deterministic id, no _epoch suffix).
    expect(mountedIds).toEqual([`ws_w1_${paneId}`])

    fireEvent.click(screen.getByRole('button', { name: /restart/i }))

    // The OLD (epoch-0) shell was closed for real — a bare epoch bump would have
    // left it alive in the tmux server as recoverable cruft.
    expect(closeCalls).toEqual([`ws_w1_${paneId}`])
    // ...and the close happened BEFORE the fresh epoch-1 shell mounted.
    expect(mountedIds).toEqual([`ws_w1_${paneId}`, `ws_w1_${paneId}_1`])

    // A second restart closes the now-current (epoch-1) shell before epoch 2.
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    expect(closeCalls).toEqual([`ws_w1_${paneId}`, `ws_w1_${paneId}_1`])
    expect(mountedIds[mountedIds.length - 1]).toBe(`ws_w1_${paneId}_2`)
  })

  it('a VOLATILE pane restart stays a plain epoch bump (no terminal.close)', () => {
    const s = oneShellGrid()
    const paneId = s.panes[0]!.id
    render(<Harness initial={s} viewComponent={persistenceStub(false)} />)
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    // The socket teardown ends a volatile shell; no explicit kill is sent.
    expect(closeCalls).toHaveLength(0)
    // The fresh shell still started (the restart still happened).
    expect(mountedIds[mountedIds.length - 1]).toBe(`ws_w1_${paneId}_1`)
  })

  it("a FOREIGN attach pane restart never kills the user's own session", () => {
    // A foreign-attach pane: no cli, an attach target instead.
    const s: WorkspaceState = {
      ...emptyWorkspace('w1', 'Alpha', 'grid'),
      panes: [{ id: 'p1', label: 'foreign', attach: 'victors_own', epoch: 0 }],
      activePane: 'p1',
    }
    render(<Harness initial={s} viewComponent={persistenceStub(true)} />)
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    // Even though the stub reports persistent, a foreign attach is never killed.
    expect(closeCalls).toHaveLength(0)
  })
})
