import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyCommandCard } from './CopyCommandCard'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.clearAllMocks())

describe('CopyCommandCard — honest copy-paste, no fake action', () => {
  it('renders the command verbatim as code', () => {
    render(<CopyCommandCard command="curl -fsSL https://hermes.sh/install | sh" />)
    expect(screen.getByText('curl -fsSL https://hermes.sh/install | sh')).toBeInTheDocument()
  })

  it('copies the EXACT command to the clipboard on click', async () => {
    const user = userEvent.setup()
    // Stub AFTER userEvent.setup() so its own clipboard shim doesn't override us.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<CopyCommandCard command="curl -fsSL https://hermes.sh/install | sh" />)
    await user.click(screen.getByRole('button', { name: /copy/i }))

    expect(writeText).toHaveBeenCalledWith('curl -fsSL https://hermes.sh/install | sh')
  })

  it('does not report success when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    render(<CopyCommandCard command="curl -fsSL https://hermes.sh/install | sh" />)
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))

    expect(toast.success).not.toHaveBeenCalled()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Couldn’t copy the command'))
  })

  it('is a copy affordance only — it never claims the command ran', () => {
    render(<CopyCommandCard command="curl -fsSL https://hermes.sh/install | sh" />)
    // No "Run", "Install now", or "Installed" button — copy-paste only (the BFF
    // can't sense a PATH reload, so it must not fake a run).
    expect(screen.queryByRole('button', { name: /run|install now|installed/i })).toBeNull()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })
})
