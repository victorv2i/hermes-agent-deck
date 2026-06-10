import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PendingApproval } from '@/state/chatStore'
import { ApprovalCard } from './ApprovalCard'

const approval: PendingApproval = {
  run_id: 'run_1',
  command: 'rm -rf /tmp/cache',
  description: 'Delete the build cache',
  choices: ['once', 'session', 'always', 'deny'],
}

describe('ApprovalCard', () => {
  it('shows the command and description', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)
    expect(screen.getByText('rm -rf /tmp/cache')).toBeInTheDocument()
    expect(screen.getByText('Delete the build cache')).toBeInTheDocument()
  })

  it('leads with a plain-language ask before the raw command (no jargon first)', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)
    // A non-technical user reads what they're approving in plain language first.
    expect(screen.getByText(/your agent needs your ok to run this/i)).toBeInTheDocument()
    // The raw command is still available for power users, under a clear label.
    expect(screen.getByText('Command')).toBeInTheDocument()
  })

  it('falls back to an honest plain line when the gateway gives no description', () => {
    render(<ApprovalCard approval={{ ...approval, description: '' }} onRespond={() => {}} />)
    expect(screen.getByText(/run a command on your computer/i)).toBeInTheDocument()
    expect(screen.getByText('rm -rf /tmp/cache')).toBeInTheDocument()
  })

  it.each([
    ['Allow once', 'once'],
    ['Allow for session', 'session'],
    ['Always allow', 'always'],
    ['Deny', 'deny'],
  ] as const)('emits %s -> %s', async (label, choice) => {
    const user = userEvent.setup()
    const onRespond = vi.fn()
    render(<ApprovalCard approval={approval} onRespond={onRespond} />)
    await user.click(screen.getByRole('button', { name: label }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith(choice)
  })

  it('only renders the choices the gateway offered', () => {
    render(
      <ApprovalCard approval={{ ...approval, choices: ['once', 'deny'] }} onRespond={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow for session' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument()
  })

  it('disables the buttons while a response is in flight', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} busy />)
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  })

  it('moves focus to the primary Allow button on mount', async () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)
    // The first allow choice is the primary action a keyboard/SR user lands on.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow once' })).toHaveFocus())
  })

  it('announces the approval assertively via a live region', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)
    const card = screen.getByTestId('approval-card')
    // Assertive so screen readers interrupt mid-stream when a gate appears.
    expect(card).toHaveAttribute('aria-live', 'assertive')
    // It is NOT an alertdialog (we provide no focus trap / modal semantics);
    // it's a labelled group that moves focus to its primary action.
    expect(card).toHaveAttribute('role', 'group')
  })

  it('pulses once on mount then settles to a static ring (B1)', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)
    const card = screen.getByTestId('approval-card')
    // One calm breathing ring on mount draws the eye to a pending gate, then it
    // settles (animation-iteration-count: 1) to the static ring — never strobing,
    // and neutralized under prefers-reduced-motion by the index.css blanket guard.
    expect(card).toHaveClass('ad-attention-pulse')
    expect(card).toHaveStyle({ animationIterationCount: '1' })
  })

  describe('keyboard accelerators (A2)', () => {
    it('resolves Allow-once on the "A" key when focus is in the card', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(<ApprovalCard approval={approval} onRespond={onRespond} />)
      // Focus already lands on the least-permissive Allow button on mount.
      await user.keyboard('a')
      expect(onRespond).toHaveBeenCalledTimes(1)
      expect(onRespond).toHaveBeenCalledWith('once')
    })

    it('resolves Deny on the "D" key when focus is in the card', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(<ApprovalCard approval={approval} onRespond={onRespond} />)
      await user.keyboard('d')
      expect(onRespond).toHaveBeenCalledTimes(1)
      expect(onRespond).toHaveBeenCalledWith('deny')
    })

    it('is case-insensitive (uppercase A / D)', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(<ApprovalCard approval={approval} onRespond={onRespond} />)
      await user.keyboard('{Shift>}A{/Shift}')
      expect(onRespond).toHaveBeenCalledWith('once')
    })

    it('does NOT keyboard-bind the permissive grants (session / always)', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(<ApprovalCard approval={approval} onRespond={onRespond} />)
      // No key grants "session" or "always" — those stay click-only so a stray
      // keystroke can never silently grant a standing permission.
      await user.keyboard('s')
      await user.keyboard('l')
      expect(onRespond).not.toHaveBeenCalled()
    })

    it('does not bind "A" when Allow-once was not offered', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(
        <ApprovalCard
          approval={{ ...approval, choices: ['session', 'always', 'deny'] }}
          onRespond={onRespond}
        />,
      )
      await user.keyboard('a')
      expect(onRespond).not.toHaveBeenCalled()
      // Deny is still bound.
      await user.keyboard('d')
      expect(onRespond).toHaveBeenCalledWith('deny')
    })

    it('does not bind "D" when Deny was not offered', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(
        <ApprovalCard
          approval={{ ...approval, choices: ['once', 'session'] }}
          onRespond={onRespond}
        />,
      )
      await user.keyboard('d')
      expect(onRespond).not.toHaveBeenCalled()
      await user.keyboard('a')
      expect(onRespond).toHaveBeenCalledWith('once')
    })

    it('ignores the accelerators while busy', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(<ApprovalCard approval={approval} onRespond={onRespond} busy />)
      await user.keyboard('a')
      await user.keyboard('d')
      expect(onRespond).not.toHaveBeenCalled()
    })

    it('shows aria-hidden key hints without changing the buttons accessible name', () => {
      render(<ApprovalCard approval={approval} onRespond={() => {}} />)
      // The accessible name is still the plain label (the kbd is aria-hidden), so
      // SR users and the name-based queries are unaffected.
      const allow = screen.getByRole('button', { name: 'Allow once' })
      const deny = screen.getByRole('button', { name: 'Deny' })
      // The visible hint glyph is present but hidden from the a11y tree.
      const hintA = allow.querySelector('kbd')
      const hintD = deny.querySelector('kbd')
      expect(hintA).toHaveTextContent('A')
      expect(hintA).toHaveAttribute('aria-hidden')
      expect(hintD).toHaveTextContent('D')
      // The permissive grants carry NO key hint (they aren't keyboard-bound).
      expect(
        screen.getByRole('button', { name: 'Allow for session' }).querySelector('kbd'),
      ).toBeNull()
      expect(screen.getByRole('button', { name: 'Always allow' }).querySelector('kbd')).toBeNull()
    })

    it('does not fire when focus is outside the card (keys are card-scoped)', async () => {
      const user = userEvent.setup()
      const onRespond = vi.fn()
      render(
        <div>
          <input data-testid="outside" aria-label="outside" />
          <ApprovalCard approval={approval} onRespond={onRespond} />
        </div>,
      )
      // Move focus to an input outside the card and type — must not trigger.
      const outside = screen.getByTestId('outside')
      outside.focus()
      await user.keyboard('a')
      await user.keyboard('d')
      expect(onRespond).not.toHaveBeenCalled()
    })
  })

  it('re-grabs focus when a second approval (same run, new id) arrives (A3)', async () => {
    const first: PendingApproval = { ...approval, approval_id: 'ap_1' }
    const second: PendingApproval = { ...approval, approval_id: 'ap_2' }
    const { rerender } = render(<ApprovalCard approval={first} onRespond={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow once' })).toHaveFocus())
    // Move focus elsewhere, then deliver a second approval on the SAME run.
    ;(document.activeElement as HTMLElement | null)?.blur()
    rerender(<ApprovalCard approval={second} onRespond={() => {}} />)
    // Focus must re-land on the least-permissive Allow for the new approval —
    // keying the effect on run_id alone would leave the user stranded.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow once' })).toHaveFocus())
  })
})
