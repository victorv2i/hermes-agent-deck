import { describe, it, expect, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TerminalMultiView } from './TerminalMultiView'
import { TERMINAL_VIEW_MODE_KEY } from './terminalSessions'
import type { DetectedCli } from './useTerminalClis'
import type { TerminalViewProps } from './TerminalView'

/**
 * A lightweight stand-in for the heavy xterm view. It records each mount with its
 * `cli` prop so we can assert how many live terminals exist and which preset they
 * carry, and reports a 'connected' status so the host's per-session affordances
 * light up.
 */
const mounts: Array<{ cli?: string }> = []
function StubView({ cli, onStatusChange }: TerminalViewProps) {
  useEffect(() => {
    mounts.push({ cli })
    onStatusChange?.('connected')
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
