import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ToolCall } from '@/state/chatStore'
import { ToolCard } from './ToolCard'

const completed: ToolCall = {
  tool: 'bash',
  status: 'completed',
  preview: 'ls -la /tmp',
  duration: 1.4,
}

describe('ToolCard', () => {
  it('renders a collapsed one-line chip with tool, summary, and duration', () => {
    render(<ToolCard call={completed} />)
    // The chip shows the plain-language label for the known `bash` tool.
    expect(screen.getByText('Run command')).toBeInTheDocument()
    expect(screen.getByText(/ls -la \/tmp/)).toBeInTheDocument()
    expect(screen.getByText(/1\.4s/)).toBeInTheDocument()
    // Collapsed by default: trigger is not expanded, detail panel is hidden.
    expect(screen.getByTestId('toolcard-trigger')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'closed')
  })

  it('does not auto-expand and expands only on click', async () => {
    const user = userEvent.setup()
    render(<ToolCard call={{ ...completed, preview: 'echo hi' }} />)
    expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'closed')
    await user.click(screen.getByTestId('toolcard-trigger'))
    expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'open')
  })

  it('shows a running spinner state', () => {
    render(<ToolCard call={{ tool: 'web_search', status: 'running' }} />)
    // A mapped running tool reads as a clean present-tense action; liveness is
    // carried by the spinner + the "· running…" summary, not a "Running" prefix
    // stacked onto the action label.
    expect(screen.getByText('Search the web')).toBeInTheDocument()
    expect(screen.getByText(/running…/)).toBeInTheDocument()
    // It must NOT read as the broken "Running Search the web".
    expect(screen.queryByText(/Running\s+Search/)).not.toBeInTheDocument()
  })

  describe('the expanded detail panel', () => {
    it('renders the best-available output on expand, labeled honestly', async () => {
      const user = userEvent.setup()
      render(<ToolCard call={completed} />)
      await user.click(screen.getByTestId('toolcard-trigger'))
      const panel = screen.getByTestId('toolcard-content')
      // The gateway's tool.completed carries no result payload, so the richest
      // text we have is the started preview — surfaced under an honest label.
      expect(panel).toHaveTextContent('ls -la /tmp')
      expect(panel.textContent?.toLowerCase()).toContain('preview')
    })

    it('is honest when the gateway captured no per-tool detail', async () => {
      const user = userEvent.setup()
      render(<ToolCard call={{ tool: 'bash', status: 'completed', duration: 0.2 }} />)
      await user.click(screen.getByTestId('toolcard-trigger'))
      expect(screen.getByTestId('toolcard-content')).toHaveTextContent(/no .*captured/i)
    })
  })

  describe('the failed state', () => {
    const failed: ToolCall = {
      tool: 'bash',
      status: 'failed',
      error: true,
      errorMessage: 'exit code 1: command not found',
    }

    it('tints the chip with the semantic destructive color', () => {
      render(<ToolCard call={failed} />)
      const trigger = screen.getByTestId('toolcard-trigger')
      expect(trigger.className).toMatch(/text-destructive/)
    })

    it('surfaces the real error message on expand in a destructive panel', async () => {
      const user = userEvent.setup()
      render(<ToolCard call={failed} />)
      await user.click(screen.getByTestId('toolcard-trigger'))
      const error = await screen.findByTestId('toolcard-error')
      expect(error).toHaveTextContent('exit code 1: command not found')
      // Destructive semantic styling, not just plain text.
      expect(error.className).toMatch(/destructive/)
    })
  })

  describe('the relative timestamp', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-30T12:00:00Z'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows a relative timestamp when the call carries a completion time', () => {
      const fiveMinAgo = Date.now() - 5 * 60_000
      render(<ToolCard call={{ ...completed, completedAt: fiveMinAgo }} />)
      expect(screen.getByText(/5m ago/)).toBeInTheDocument()
    })

    it('renders no timestamp when the completion time is unknown — never fabricated', () => {
      render(<ToolCard call={{ ...completed, completedAt: undefined }} />)
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
    })
  })

  describe('plain-language tool labels (dual-audience)', () => {
    it('shows a friendly label for a known tool on the collapsed chip', () => {
      render(<ToolCard call={{ ...completed, tool: 'bash' }} />)
      // Newcomers see "Run command" rather than the bare tool name on the chip.
      expect(screen.getByTestId('toolcard-trigger')).toHaveTextContent(/Run command/)
    })

    it('falls back to the raw tool name for an unknown tool (honesty)', () => {
      render(<ToolCard call={{ ...completed, tool: 'spelunk_db' }} />)
      expect(screen.getByTestId('toolcard-trigger')).toHaveTextContent('spelunk_db')
    })

    it('keeps the real tool name visible in the expanded detail panel', async () => {
      const user = userEvent.setup()
      render(<ToolCard call={{ ...completed, tool: 'bash' }} />)
      await user.click(screen.getByTestId('toolcard-trigger'))
      // The plain label never hides the real name — power users still see "bash".
      expect(screen.getByTestId('toolcard-content')).toHaveTextContent('bash')
    })
  })

  describe('defaultOpen (detailed verbosity)', () => {
    it('opens on mount when defaultOpen is set', () => {
      render(<ToolCard call={completed} defaultOpen />)
      expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'open')
    })
  })

  describe('controlled open state (for expand-all / collapse-all)', () => {
    it('respects the open prop and reports changes via onOpenChange', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      const { rerender } = render(
        <ToolCard call={completed} open={false} onOpenChange={onOpenChange} />,
      )
      expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'closed')

      rerender(<ToolCard call={completed} open={true} onOpenChange={onOpenChange} />)
      expect(screen.getByTestId('toolcard-content')).toHaveAttribute('data-state', 'open')

      await user.click(screen.getByTestId('toolcard-trigger'))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
