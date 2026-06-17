import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationOutline } from './ConversationOutline'

afterEach(() => {
  vi.restoreAllMocks()
})

const ITEMS = [
  { id: 'u1', label: 'Summarize my morning' },
  { id: 'u2', label: 'Now plan my week' },
  { id: 'u3', label: 'Read this repo' },
]

function setup(over: Partial<React.ComponentProps<typeof ConversationOutline>> = {}) {
  const props = {
    items: ITEMS,
    activeId: 'u2' as string | null,
    onJump: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<ConversationOutline {...props} />)
  return props
}

describe('ConversationOutline', () => {
  it('is a labelled navigation landmark listing every user prompt', () => {
    setup()
    expect(screen.getByRole('navigation', { name: /conversation outline/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Summarize my morning/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Now plan my week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Read this repo/i })).toBeInTheDocument()
  })

  it('numbers the prompts in conversation order', () => {
    setup()
    // The ordinal prefix orients the user in a long chat.
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('2.')).toBeInTheDocument()
    expect(screen.getByText('3.')).toBeInTheDocument()
  })

  it('marks the in-view prompt with aria-current and the sky-blue accent', () => {
    setup({ activeId: 'u2' })
    const active = screen.getByRole('button', { name: /Now plan my week/i })
    expect(active).toHaveAttribute('aria-current', 'true')
    expect(active.className).toContain('bg-primary/10')
    // The others are not current.
    expect(screen.getByRole('button', { name: /Read this repo/i })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('marks no prompt current when activeId is null', () => {
    setup({ activeId: null })
    for (const item of ITEMS) {
      expect(screen.getByRole('button', { name: new RegExp(item.label, 'i') })).not.toHaveAttribute(
        'aria-current',
      )
    }
  })

  it('jumps to a prompt on click', async () => {
    const user = userEvent.setup()
    const { onJump } = setup()
    await user.click(screen.getByRole('button', { name: /Read this repo/i }))
    expect(onJump).toHaveBeenCalledWith('u3')
  })

  it('closes via the × button', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()
    await user.click(screen.getByRole('button', { name: /close outline/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()
    // Focus lands on the close button on mount; Esc from within closes.
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('focuses a control on mount so keyboard users land inside it', () => {
    setup()
    expect(screen.getByRole('button', { name: /close outline/i })).toHaveFocus()
  })

  it('shows an honest empty state when there are no prompts', () => {
    setup({ items: [] })
    expect(screen.getByText(/no prompts yet/i)).toBeInTheDocument()
    // No prompt buttons render in the empty case.
    expect(screen.queryByText('1.')).not.toBeInTheDocument()
  })

  it('respects reduced motion on the interactive rows', () => {
    setup()
    const row = screen.getByRole('button', { name: /Summarize my morning/i })
    expect(row.className).toContain('motion-reduce:transition-none')
  })
})
