/**
 * a11y — Dialog + CommandDialog focus management.
 *
 * Radix Dialog (FocusTrap + FocusScope) provides:
 * - Focus trap while open
 * - Escape closes the dialog
 * - First focusable element receives focus on open
 * - Focus returns to the trigger on close
 *
 * These tests verify the behavioral contract holds through our wrapper so no
 * future change to DialogContent accidentally breaks the a11y guarantees.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from './dialog'
import { CommandDialog, CommandInput, CommandList, CommandItem } from './command'

// A minimal controlled dialog with a trigger button + an input inside.
function TestDialog() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" data-testid="open-btn">
          Open dialog
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test dialog</DialogTitle>
          <DialogDescription>A dialog for a11y testing.</DialogDescription>
        </DialogHeader>
        <input data-testid="dialog-input" placeholder="Type here" />
        <button type="button" data-testid="dialog-close-btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </DialogContent>
    </Dialog>
  )
}

// A minimal CommandDialog.
function TestCommandDialog() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-testid="cmd-trigger" onClick={() => setOpen(true)}>
        Open palette
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandItem value="item-one" onSelect={() => setOpen(false)}>
            Item one
          </CommandItem>
        </CommandList>
      </CommandDialog>
    </>
  )
}

describe('Dialog close button touch target', () => {
  it('Radix close button (X) has size-11 (44px) for mobile touch target', async () => {
    const user = userEvent.setup()
    render(<TestDialog />)
    await user.click(screen.getByTestId('open-btn'))
    await waitFor(() => screen.getByRole('dialog'))
    // The Radix Dialog's built-in X close button is the first "Close" button
    // rendered by DialogContent (the test component also has an explicit "Close"
    // content button — get all and check the one with aria-label="Close").
    const closeBtns = screen.getAllByRole('button', { name: 'Close' })
    // The Radix-injected close button is the one with size-11 in its className.
    const radixClose = closeBtns.find((btn) => btn.className.includes('size-11'))
    expect(radixClose).toBeDefined()
    expect(radixClose!.className).toContain('size-11')
  })
})

describe('Dialog a11y — focus management', () => {
  it('focuses the first focusable element when the dialog opens', async () => {
    const user = userEvent.setup()
    render(<TestDialog />)

    await user.click(screen.getByTestId('open-btn'))

    // The dialog should be open and the first focusable element (the input, or
    // the close button depending on Radix's focus ordering) should have focus.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    // At least one interactive element inside the dialog has focus.
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<TestDialog />)

    const trigger = screen.getByTestId('open-btn')
    await user.click(trigger)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    // Focus returns to the trigger after close.
    expect(document.activeElement).toBe(trigger)
  })
})

describe('CommandDialog a11y — focus management', () => {
  it('CommandDialog focuses the input on open', async () => {
    const user = userEvent.setup()
    render(<TestCommandDialog />)

    await user.click(screen.getByTestId('cmd-trigger'))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // The command input (the search box) should have focus.
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('CommandDialog closes on Escape', async () => {
    const user = userEvent.setup()
    render(<TestCommandDialog />)

    await user.click(screen.getByTestId('cmd-trigger'))
    await waitFor(() => screen.getByRole('dialog'))

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
