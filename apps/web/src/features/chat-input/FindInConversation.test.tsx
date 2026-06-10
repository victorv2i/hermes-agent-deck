import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FindInConversation } from './FindInConversation'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Render with sensible defaults; override per test. */
function setup(over: Partial<React.ComponentProps<typeof FindInConversation>> = {}) {
  const props = {
    query: 'foo',
    matches: [0, 1, 2] as readonly unknown[],
    activeIndex: 0,
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<FindInConversation {...props} />)
  return props
}

describe('FindInConversation', () => {
  it('is a search region with a labelled input that auto-focuses', () => {
    setup()
    expect(screen.getByRole('search', { name: /find in conversation/i })).toBeInTheDocument()
    const input = screen.getByRole('searchbox', { name: /find in conversation/i })
    expect(input).toHaveFocus()
  })

  it('shows a 1-based match count', () => {
    setup({ activeIndex: 1, matches: [0, 1, 2] })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('shows "No matches" for a non-empty query with zero matches', () => {
    setup({ query: 'zzz', matches: [], activeIndex: -1 })
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })

  it('shows no count for an empty query', () => {
    setup({ query: '', matches: [], activeIndex: -1 })
    expect(screen.queryByText(/no matches/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+\s*\/\s*\d+/)).not.toBeInTheDocument()
  })

  it('reports query changes as the user types', async () => {
    const user = userEvent.setup()
    const { onQueryChange } = setup({ query: '' })
    await user.type(screen.getByRole('searchbox'), 'a')
    expect(onQueryChange).toHaveBeenCalledWith('a')
  })

  it('Enter steps to the next match', async () => {
    const user = userEvent.setup()
    const { onNext, onPrev } = setup()
    screen.getByRole('searchbox').focus()
    await user.keyboard('{Enter}')
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('Shift+Enter steps to the previous match', async () => {
    const user = userEvent.setup()
    const { onPrev, onNext } = setup()
    screen.getByRole('searchbox').focus()
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('Enter does nothing when there are no matches', async () => {
    const user = userEvent.setup()
    const { onNext } = setup({ query: 'zzz', matches: [], activeIndex: -1 })
    screen.getByRole('searchbox').focus()
    await user.keyboard('{Enter}')
    expect(onNext).not.toHaveBeenCalled()
  })

  it('Escape closes', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()
    screen.getByRole('searchbox').focus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the next/prev steppers invoke their handlers', async () => {
    const user = userEvent.setup()
    const { onNext, onPrev } = setup()
    const next = screen.getByRole('button', { name: /next match/i })
    const prev = screen.getByRole('button', { name: /previous match/i })
    expect(next.className).toContain('size-11')
    expect(prev.className).toContain('size-11')
    expect(screen.getByRole('searchbox').className).toContain('h-11')
    await user.click(next)
    await user.click(prev)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('the close button invokes onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()
    await user.click(screen.getByRole('button', { name: /close find/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables the steppers when there are no matches', () => {
    setup({ query: 'zzz', matches: [], activeIndex: -1 })
    expect(screen.getByRole('button', { name: /next match/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous match/i })).toBeDisabled()
  })

  it('exposes the count via an aria-live region', () => {
    setup({ activeIndex: 0, matches: [0, 1] })
    const live = screen.getByText('1 / 2')
    expect(live).toHaveAttribute('aria-live', 'polite')
  })

  it('keeps the match counter legible (muted, not tertiary) — incl. "No matches"', () => {
    // The counter is feedback the user is actively waiting on, so it must stay
    // readable rather than fade to the faintest tier in any state.
    const { rerender } = render(
      <FindInConversation
        query="foo"
        matches={[0, 1, 2]}
        activeIndex={0}
        onQueryChange={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('1 / 3').className).toContain('text-muted-foreground')
    expect(screen.getByText('1 / 3').className).not.toContain('text-foreground-tertiary')

    rerender(
      <FindInConversation
        query="zzz"
        matches={[]}
        activeIndex={-1}
        onQueryChange={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/no matches/i).className).toContain('text-muted-foreground')
    expect(screen.getByText(/no matches/i).className).not.toContain('text-foreground-tertiary')
  })
})
