import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalLauncher } from './TerminalLauncher'
import type { DetectedCli } from './useTerminalClis'

const installed: DetectedCli[] = [
  { id: 'hermes', label: 'Hermes CLI', available: true },
  {
    id: 'claude',
    label: 'Claude Code',
    available: false,
    installUrl: 'https://docs.anthropic.com/claude-code',
  },
  { id: 'codex', label: 'Codex', available: true },
  { id: 'shell', label: 'Raw shell', available: true },
]

describe('TerminalLauncher', () => {
  it('renders an actionable launch button for each INSTALLED CLI', () => {
    render(<TerminalLauncher clis={installed} onLaunch={() => {}} />)
    // Hermes / Codex / Raw shell are installed → real launch buttons.
    const hermes = screen.getByRole('button', { name: /launch the hermes cli/i })
    expect(hermes).toBeEnabled()
    expect(hermes.className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: /launch the codex/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /launch the raw shell/i })).toBeEnabled()
  })

  it('renders a MISSING CLI as muted with an honest "not installed" + a real install link', () => {
    render(<TerminalLauncher clis={installed} onLaunch={() => {}} />)
    // Claude Code is missing → no launch button, an honest not-installed note,
    // and a real "Install" link to the official docs.
    expect(screen.queryByRole('button', { name: /launch the claude code/i })).toBeNull()
    expect(screen.getByText(/not installed/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /install/i })
    expect(link).toHaveAttribute('href', 'https://docs.anthropic.com/claude-code')
    expect(link.className).toContain('min-h-11')
  })

  it('emits the selected preset id on launch', () => {
    const onLaunch = vi.fn()
    render(<TerminalLauncher clis={installed} onLaunch={onLaunch} />)
    fireEvent.click(screen.getByRole('button', { name: /launch the codex/i }))
    expect(onLaunch).toHaveBeenCalledWith('codex')
  })

  it('shows the Hermes CLI rationale (why it is here even with native chat)', () => {
    render(<TerminalLauncher clis={installed} onLaunch={() => {}} />)
    // The Hermes card explains the client-only features the web chat can't expose.
    expect(screen.getByText(/slash commands|repl|client-only/i)).toBeInTheDocument()
  })

  it('renders a calm loading state while the CLI list is unknown', () => {
    render(<TerminalLauncher clis={undefined} onLaunch={() => {}} />)
    expect(screen.getByText(/checking|detecting/i)).toBeInTheDocument()
  })

  describe('failed CLI-detection probe (P2 — never stuck on "Checking…")', () => {
    it('renders the preset grid (raw shell actionable) instead of hanging on the placeholder', () => {
      render(<TerminalLauncher clis={undefined} failed onLaunch={() => {}} />)
      // No "Checking…" placeholder — the launcher is usable.
      expect(screen.queryByText(/checking which clis/i)).toBeNull()
      // The raw shell is ALWAYS actionable (needs no probe).
      expect(screen.getByRole('button', { name: /launch the raw shell/i })).toBeEnabled()
      // The agent CLIs are shown as unconfirmed (not actionable) with install links.
      expect(screen.queryByRole('button', { name: /launch the hermes cli/i })).toBeNull()
      // An honest note explains the probe couldn't run.
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't check which agent clis/i)
    })

    it('the raw shell still launches when the probe failed', () => {
      const onLaunch = vi.fn()
      render(<TerminalLauncher clis={undefined} failed onLaunch={onLaunch} />)
      fireEvent.click(screen.getByRole('button', { name: /launch the raw shell/i }))
      expect(onLaunch).toHaveBeenCalledWith('shell')
    })

    it('offers a Retry that re-runs the probe', () => {
      const onRetry = vi.fn()
      render(<TerminalLauncher clis={undefined} failed onRetry={onRetry} onLaunch={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('prefers a real CLI list over the fallback even if `failed` is passed', () => {
      // A late-arriving real list wins; no failed note is shown.
      render(<TerminalLauncher clis={installed} failed onLaunch={() => {}} />)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByRole('button', { name: /launch the hermes cli/i })).toBeEnabled()
    })
  })

  describe('tmux persistence sections', () => {
    const nowEpoch = Math.floor(Date.now() / 1000)
    const session = (name: string, deckOwned: boolean, attachedCount = 0) => ({
      name,
      deckOwned,
      attachedCount,
      createdEpoch: nowEpoch - 2 * 3600,
      lastActivityEpoch: nowEpoch - 5 * 60,
      persistent: true,
    })

    it('says honestly when shells cannot persist (no tmux)', () => {
      render(
        <TerminalLauncher
          clis={installed}
          onLaunch={() => {}}
          tmux={{ tmuxAvailable: false, sessions: [] }}
        />,
      )
      expect(
        screen.getByText('Shells on this host are not persistent (tmux not installed).'),
      ).toBeInTheDocument()
    })

    it('says nothing about persistence while the list is unknown', () => {
      render(<TerminalLauncher clis={installed} onLaunch={() => {}} />)
      expect(screen.queryByText(/not persistent/i)).toBeNull()
      expect(screen.queryByText(/your tmux sessions/i)).toBeNull()
    })

    it('lists the users own tmux sessions with an Attach button each', () => {
      const onAttach = vi.fn()
      render(
        <TerminalLauncher
          clis={installed}
          onLaunch={() => {}}
          onAttach={onAttach}
          tmux={{
            tmuxAvailable: true,
            sessions: [session('my_session', false, 1), session('scratch', false)],
          }}
        />,
      )
      expect(screen.getByText('Your tmux sessions')).toBeInTheDocument()
      // Compact created / last-activity ages render per row.
      expect(screen.getAllByText(/created 2h ago · active 5m ago/)).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: /attach to scratch/i }))
      expect(onAttach).toHaveBeenCalledWith('scratch')
    })

    it('offers to reattach running deck shells (recovery after data loss)', () => {
      const onResume = vi.fn()
      render(
        <TerminalLauncher
          clis={installed}
          onLaunch={() => {}}
          onResume={onResume}
          tmux={{
            tmuxAvailable: true,
            sessions: [session('adk_term-1-ab12-0', true)],
          }}
        />,
      )
      expect(screen.getByText(/deck shell is still running/i)).toBeInTheDocument()
      // The row shows the wire id (the adk_ prefix is deck plumbing).
      expect(screen.getByText('term-1-ab12-0')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /reattach/i }))
      expect(onResume).toHaveBeenCalledTimes(1)
    })

    it('renders no session sections when the tmux server is empty', () => {
      render(
        <TerminalLauncher
          clis={installed}
          onLaunch={() => {}}
          onAttach={() => {}}
          onResume={() => {}}
          tmux={{ tmuxAvailable: true, sessions: [] }}
        />,
      )
      expect(screen.queryByText('Your tmux sessions')).toBeNull()
      expect(screen.queryByText(/still running/i)).toBeNull()
    })
  })
})
