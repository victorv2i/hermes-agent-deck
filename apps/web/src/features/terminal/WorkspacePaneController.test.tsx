import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type ComponentType } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { WorkspacePaneController } from './WorkspacePaneController'
import { fromDefinition, writeWorkspaceState } from './terminalWorkspaces'
import type { DetectedCli } from './useTerminalClis'
import type { WorkspaceDefinition } from '@agent-deck/protocol'
import type { TerminalViewProps } from './TerminalView'

/**
 * The SAVED-WORKSPACE controller restores the controller-level coverage the old
 * WorkspaceRoute tests provided, now against the unified-surface controller. It
 * asserts the durable contract the route relied on:
 *  - editing the pane set PATCHes the server, debounced (~600ms) with the correct
 *    body, and the very first (freshly-seeded) signature is NOT sent back,
 *  - a CLI change made via the per-pane settings bar reaches that PATCH payload,
 *  - a phone viewport seeds TAB view (even when the cache prefers grid).
 *
 * fetch is injected so no live BFF is touched, and the terminal view is a stub so
 * the real xterm engine never mounts (the same seam ScratchPaneController.test and
 * TerminalSurface.test use). Fake timers drive the debounce deterministically.
 */

/** A stub view that reports `connected` so the grid mounts panes without xterm. */
function StubView({ cli, onStatusChange }: TerminalViewProps) {
  onStatusChange?.('connected')
  return <div data-testid="terminal-view">{cli ?? 'shell'}</div>
}

const CLIS: DetectedCli[] = [
  { id: 'hermes', label: 'Hermes CLI', available: true },
  { id: 'claude', label: 'Claude Code', available: false },
  { id: 'codex', label: 'Codex', available: true },
  { id: 'shell', label: 'Raw shell', available: true },
]

/** A one-pane workspace definition (a single shell pane), the server's truth. */
function oneShellDef(): WorkspaceDefinition {
  return {
    id: 'w1',
    name: 'Alpha',
    panes: [{ id: 'shell-1-aaa11111', label: 'Shell 1', cli: 'shell' }],
    createdAt: 'x',
    lastModifiedAt: 'x',
  }
}

/** A fetch that records every PATCH it sees (url + parsed body) and 200s. */
function patchRecordingFetch() {
  const patches: Array<{ url: string; body: unknown }> = []
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined })
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, patches }
}

/** Mock matchMedia so the mobile breakpoint (and only it) reports a match. */
function mockPhoneViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

function renderController(
  def: WorkspaceDefinition,
  fetchImpl: typeof fetch,
  view: ComponentType<TerminalViewProps> = StubView,
) {
  return render(
    <WorkspacePaneController def={def} clis={CLIS} fetchImpl={fetchImpl} viewComponent={view} />,
  )
}

/** Open the "+" preset menu and add a raw-shell pane (a durable pane-set edit). */
function addShellPane() {
  fireEvent.click(screen.getByRole('button', { name: /add pane/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /raw shell/i }))
}

describe('WorkspacePaneController', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('debounced PATCH of the durable pane set', () => {
    it('does NOT PATCH the freshly-seeded definition (the first signature is skipped)', () => {
      const rec = patchRecordingFetch()
      renderController(oneShellDef(), rec.impl)
      // Let any debounce window elapse: a seed-only mount must send nothing back.
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(rec.patches).toHaveLength(0)
    })

    it('PATCHes the new pane set ~600ms after an edit, with the correct body', () => {
      const rec = patchRecordingFetch()
      renderController(oneShellDef(), rec.impl)

      addShellPane()

      // The save is debounced: nothing has fired just before the window closes.
      act(() => {
        vi.advanceTimersByTime(599)
      })
      expect(rec.patches).toHaveLength(0)

      // ...and exactly one PATCH fires once the 600ms window elapses.
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(rec.patches).toHaveLength(1)
      const patch = rec.patches[0]!
      expect(patch.url).toBe('/api/agent-deck/terminal/workspaces/w1')
      const body = patch.body as { panes: Array<{ id: string; label: string; cli?: string }> }
      // The durable body now carries BOTH panes (the seeded shell + the added one).
      expect(body.panes).toHaveLength(2)
      expect(body.panes[0]).toMatchObject({
        id: 'shell-1-aaa11111',
        label: 'Shell 1',
        cli: 'shell',
      })
      expect(body.panes[1]).toMatchObject({ label: 'Shell 2', cli: 'shell' })
    })

    it('coalesces a burst of edits into a single PATCH', () => {
      const rec = patchRecordingFetch()
      renderController(oneShellDef(), rec.impl)
      addShellPane()
      act(() => {
        vi.advanceTimersByTime(300)
      })
      addShellPane()
      // The second edit restarts the window; only the latest state is sent once.
      act(() => {
        vi.advanceTimersByTime(600)
      })
      expect(rec.patches).toHaveLength(1)
      const body = rec.patches[0]!.body as { panes: unknown[] }
      expect(body.panes).toHaveLength(3)
    })
  })

  describe('per-pane settings bar', () => {
    it('a CLI change via the settings bar reaches the PATCH payload', () => {
      const rec = patchRecordingFetch()
      renderController(oneShellDef(), rec.impl)

      // The active pane's CLI picker lives in the settings bar; switch it to Codex.
      fireEvent.click(screen.getByRole('button', { name: /choose cli/i }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: /codex/i }))

      act(() => {
        vi.advanceTimersByTime(600)
      })
      expect(rec.patches).toHaveLength(1)
      const body = rec.patches[0]!.body as { panes: Array<{ id: string; cli?: string }> }
      expect(body.panes).toHaveLength(1)
      expect(body.panes[0]).toMatchObject({ id: 'shell-1-aaa11111', cli: 'codex' })
    })
  })

  describe('responsive view seeding', () => {
    it('seeds TAB view on a phone even when the cache prefers grid', () => {
      // Cache a GRID preference for this workspace (via the real writer, so the key
      // + shape stay in sync); the phone breakpoint must still override it to tab.
      writeWorkspaceState({ ...fromDefinition(oneShellDef()), viewMode: 'grid' })
      mockPhoneViewport()
      const rec = patchRecordingFetch()
      renderController(oneShellDef(), rec.impl)

      // Tab view is active (its toggle segment is pressed) and the grid container
      // (rendered only in grid view) is absent.
      expect(screen.getByRole('button', { name: /tab view/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.queryByRole('group', { name: /pane grid/i })).toBeNull()
    })
  })
})
