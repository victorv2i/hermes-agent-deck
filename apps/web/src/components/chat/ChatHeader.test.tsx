import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ChatHeader } from './ChatHeader'

// ChatHeader now carries a "Past chats" <Link> into /history, so every render
// needs a Router context.
function renderHeader(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('ChatHeader', () => {
  it('renders the shortened model name in the chip', () => {
    renderHeader(
      <ChatHeader title="My session" model="anthropic/claude-opus-4" contextTokens={0} />,
    )
    const chip = screen.getByTestId('chat-header-model')
    // Provider prefix is trimmed for the chip; full id stays in the title.
    expect(chip).toHaveTextContent('claude-opus-4')
    expect(chip).toHaveAttribute('title', 'anthropic/claude-opus-4')
  })

  it('keeps the model chip visible on mobile (not hidden until sm:)', () => {
    // A newcomer on a phone most needs to know which model is answering, so the
    // chip must NOT be `hidden sm:inline-flex` — it shows at every width.
    renderHeader(<ChatHeader title="My session" model="gpt-5.5" contextTokens={0} />)
    const chip = screen.getByTestId('chat-header-model')
    expect(chip.className).toContain('inline-flex')
    expect(chip.className).not.toContain('hidden')
  })

  it('omits the model chip when no model is resolved', () => {
    renderHeader(<ChatHeader title="My session" model={null} contextTokens={0} />)
    expect(screen.queryByTestId('chat-header-model')).not.toBeInTheDocument()
  })

  it('renders the live run-state chip slot when supplied, and stays quiet without it', () => {
    const { rerender } = renderHeader(
      <ChatHeader
        title="My session"
        model={null}
        contextTokens={0}
        statusChip={<span data-testid="fake-chip">Working</span>}
      />,
    )
    expect(screen.getByTestId('fake-chip')).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <ChatHeader title="My session" model={null} contextTokens={0} />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('fake-chip')).not.toBeInTheDocument()
  })

  it('offers a "Past chats" link into /history — the MOBILE way into History', () => {
    // The History rail link folded into Chat; on mobile (no sessions pane) this
    // button is the way to past conversations. It carries the accessible name
    // "Past chats", points at /history, and is a >=40px touch target.
    renderHeader(<ChatHeader title="My session" model={null} contextTokens={0} />)
    const link = screen.getByRole('link', { name: /past chats/i })
    expect(link).toHaveAttribute('href', '/history')
    // size-10 = 40px → a real touch target. It hides on desktop (`lg:hidden`)
    // where the session pane already lists past chats.
    expect(link.className).toContain('size-10')
    expect(link.className).toContain('lg:hidden')
  })
})
