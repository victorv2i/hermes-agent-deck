import { describe, it, expect, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScratchPaneController } from './ScratchPaneController'
import {
  TERMINAL_SESSIONS_KEY,
  TERMINAL_VIEW_MODE_KEY,
  emptySessions,
  expectedTmuxName,
  openSession,
  writeSessions,
} from './terminalSessions'
import type { TerminalViewProps } from './TerminalView'

/**
 * The Scratch controller is the ephemeral quick terminal modeled over the EXISTING
 * terminalSessions reducer + localStorage. These tests assert it behaves
 * byte-for-byte like the prior quick terminal: it starts a session with the
 * chosen preset's `cli`, uses sessionKey wire ids (id+epoch), persists + restores
 * the open sessions across a remount (refresh-resume), reconciles/recovers against
 * the server's tmux list, and threads the fresh-shell `expectResume` signal. This
 * is the coverage that lived in the old TerminalMultiView.test, now against the
 * controller that feeds the unified grid.
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

function renderScratch(initialCli: 'hermes' | 'shell' = 'shell') {
  mounts.length = 0
  return render(<ScratchPaneController initialCli={initialCli} viewComponent={StubView} />)
}

function openAnotherShell() {
  fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /raw shell/i }))
}

describe('ScratchPaneController parity', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opens with one live terminal for the chosen preset (cli reaches the view)', () => {
    renderScratch('hermes')
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.cli).toBe('hermes')
  })

  it('the "+" opens another terminal for the chosen preset', () => {
    renderScratch('shell')
    openAnotherShell()
    expect(mounts).toHaveLength(2)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('persists the view mode and restores it on remount', () => {
    const { unmount } = renderScratch('shell')
    fireEvent.click(screen.getByRole('button', { name: /grid view/i }))
    expect(localStorage.getItem(TERMINAL_VIEW_MODE_KEY)).toBe('grid')
    unmount()
    renderScratch('shell')
    expect(screen.getByRole('group', { name: /terminal grid/i })).toBeInTheDocument()
  })

  it('restores the open sessions on remount so a refresh resumes the same shells', () => {
    const { unmount } = renderScratch('hermes')
    openAnotherShell()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    unmount()
    renderScratch('hermes')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('uses the sessionKey wire id (id+epoch) so the parked shell reattaches', () => {
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
    render(<ScratchPaneController initialCli="shell" viewComponent={CapturingView} />)
    expect(seenSessionIds).toContain('term-7-zzz999:3')
  })

  it('reconciles restored sessions against the server list (clean + recover)', () => {
    let prior = openSession(emptySessions(), 'shell')
    prior = openSession(prior, 'hermes')
    writeSessions(prior)
    const survivor = prior.sessions[1]!
    render(
      <ScratchPaneController
        initialCli="shell"
        viewComponent={StubView}
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
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /forgotten-7/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /victors_own/i })).toBeNull()
  })

  it('recoverOnly mounts only the server-recovered sessions (no fresh shell)', () => {
    render(
      <ScratchPaneController
        initialCli="shell"
        recoverOnly
        viewComponent={StubView}
        serverSessions={{
          tmuxAvailable: true,
          sessions: [{ name: 'adk_lost-1', deckOwned: true }],
        }}
      />,
    )
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /lost-1/i })).toBeInTheDocument()
  })

  it('opens a foreign attach tab when given an attach target', () => {
    const seenAttach: string[] = []
    function CapturingView({ attach }: TerminalViewProps) {
      useEffect(() => {
        if (attach) seenAttach.push(attach)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid="terminal-view">live</div>
    }
    render(
      <ScratchPaneController
        initialCli="shell"
        initialAttach="victors_own"
        viewComponent={CapturingView}
      />,
    )
    expect(seenAttach).toContain('victors_own')
    expect(screen.getByRole('tab', { name: /victors_own/i })).toBeInTheDocument()
  })

  /* -- expectResume plumbing (the fresh-shell honesty signal) ----------------- */

  const resumeMounts: Array<{ cli?: string; expectResume?: boolean }> = []
  function ResumeRecordingStub({ cli, expectResume, onStatusChange }: TerminalViewProps) {
    useEffect(() => {
      resumeMounts.push({ cli, expectResume })
      onStatusChange?.('connected')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="terminal-view">{cli}</div>
  }

  it('a RESTORED session expects a resume; a fresh "+" open does not', () => {
    resumeMounts.length = 0
    writeSessions(openSession(emptySessions(), 'shell'))
    render(<ScratchPaneController initialCli="shell" viewComponent={ResumeRecordingStub} />)
    expect(resumeMounts).toHaveLength(1)
    expect(resumeMounts[0]!.expectResume).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /raw shell/i }))
    expect(resumeMounts).toHaveLength(2)
    expect(resumeMounts[1]!.expectResume).toBe(false)
  })

  it('a server-RECOVERED session expects a resume', () => {
    resumeMounts.length = 0
    render(
      <ScratchPaneController
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

  it('reports its session list up for the Save action', () => {
    const reports: number[] = []
    render(
      <ScratchPaneController
        initialCli="shell"
        viewComponent={StubView}
        onSessionsChange={(s) => reports.push(s.sessions.length)}
      />,
    )
    // One pane to start; opening another reports the growth.
    expect(reports[reports.length - 1]).toBe(1)
    openAnotherShell()
    expect(reports[reports.length - 1]).toBe(2)
  })
})
