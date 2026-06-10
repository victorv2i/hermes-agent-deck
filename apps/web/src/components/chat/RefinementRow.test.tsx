/**
 * Tests for RefinementRow — the contextual action row on the LAST completed
 * assistant message. Visible (not hover-only), keyboard + SR accessible.
 * Each action composes a real follow-up prompt and sends through the normal run path.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RefinementRow } from './RefinementRow'

const baseProps = {
  messageText: 'Here is a summary of your project.',
  onSend: vi.fn(),
  onRetry: vi.fn(),
  disabled: false,
}

describe('RefinementRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders visible action buttons (not hover-only)', () => {
    render(<RefinementRow {...baseProps} />)
    // All buttons must be visible without hover
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /shorter/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more detail/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('Retry calls onRetry (real resend through the run path)', async () => {
    const user = userEvent.setup()
    render(<RefinementRow {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(baseProps.onRetry).toHaveBeenCalledTimes(1)
  })

  it('Shorter sends a real follow-up prompt asking for a shorter response', async () => {
    const user = userEvent.setup()
    render(<RefinementRow {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /shorter/i }))
    expect(baseProps.onSend).toHaveBeenCalledTimes(1)
    const [prompt] = baseProps.onSend.mock.calls[0]!
    expect(typeof prompt).toBe('string')
    expect(prompt.trim().length).toBeGreaterThan(0)
    // The prompt honestly asks for a shorter reply
    expect(prompt.toLowerCase()).toMatch(/shorter|concise|brief/)
  })

  it('More detail sends a real follow-up prompt asking for more detail', async () => {
    const user = userEvent.setup()
    render(<RefinementRow {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /more detail/i }))
    expect(baseProps.onSend).toHaveBeenCalledTimes(1)
    const [prompt] = baseProps.onSend.mock.calls[0]!
    expect(typeof prompt).toBe('string')
    expect(prompt.trim().length).toBeGreaterThan(0)
    expect(prompt.toLowerCase()).toMatch(/detail|elaborate|expand/)
  })

  it('Copy writes message text to clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<RefinementRow {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith(baseProps.messageText)
    // A real success flashes the "Copied!" confirmation.
    expect(await screen.findByText('Copied!')).toBeInTheDocument()
  })

  it('does NOT flash a fake "Copied!" when the clipboard is unavailable (honest UI)', async () => {
    const user = userEvent.setup()
    // No clipboard API present — the copy cannot succeed.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    render(<RefinementRow {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /copy/i }))
    // The label stays "Copy" — never a false success.
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy message/i })).toBeInTheDocument()
  })

  it('disables the send-a-prompt actions when disabled=true, but Copy (a pure read) stays reachable', () => {
    render(<RefinementRow {...baseProps} disabled />)
    // Retry / Shorter / More-detail each send a prompt through the run path → gated
    // while a run is in flight or the socket is disconnected.
    expect(screen.getByRole('button', { name: /retry/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /shorter/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /more detail/i })).toBeDisabled()
    // Copy is a pure clipboard read with no connection dependency, so the last
    // message's Copy keeps working even when everything else is gated.
    expect(screen.getByRole('button', { name: /copy/i })).toBeEnabled()
  })

  it('has keyboard accessible buttons with min-h-11 touch targets', () => {
    render(<RefinementRow {...baseProps} />)
    screen.getAllByRole('button').forEach((btn) => {
      expect(btn.className).toMatch(/min-h-11/)
    })
  })

  it('has focus-visible ring on buttons for keyboard navigation', () => {
    render(<RefinementRow {...baseProps} />)
    screen.getAllByRole('button').forEach((btn) => {
      expect(btn.className).toMatch(/focus-visible/)
    })
  })

  it('has aria-label on each button for screen readers', () => {
    render(<RefinementRow {...baseProps} />)
    screen.getAllByRole('button').forEach((btn) => {
      expect(btn).toHaveAccessibleName()
    })
  })
})
