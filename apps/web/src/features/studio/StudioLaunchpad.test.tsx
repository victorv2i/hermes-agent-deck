import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StudioLaunchpad } from './StudioLaunchpad'

describe('StudioLaunchpad', () => {
  it('shows the tending status line', () => {
    render(
      <StudioLaunchpad
        status={{ tone: 'ok', label: 'Connected', facts: ['watching 2 schedules'] }}
        onStartChat={vi.fn()}
        onOpenConnections={vi.fn()}
      />,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText(/watching 2 schedules/)).toBeInTheDocument()
  })

  it('renders a Start a chat button that fires onStartChat', async () => {
    const onStartChat = vi.fn()
    render(
      <StudioLaunchpad
        status={{ tone: 'ok', label: 'Connected', facts: [] }}
        onStartChat={onStartChat}
        onOpenConnections={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /start a chat/i }))
    expect(onStartChat).toHaveBeenCalled()
  })

  it('renders a Connections button that fires onOpenConnections', async () => {
    const onOpenConnections = vi.fn()
    render(
      <StudioLaunchpad
        status={{ tone: 'ok', label: 'Connected', facts: [] }}
        onStartChat={vi.fn()}
        onOpenConnections={onOpenConnections}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /connections/i }))
    expect(onOpenConnections).toHaveBeenCalled()
  })

  it('still renders Start a chat when there is no status yet', () => {
    render(<StudioLaunchpad status={undefined} onStartChat={vi.fn()} onOpenConnections={vi.fn()} />)
    expect(screen.getByRole('button', { name: /start a chat/i })).toBeInTheDocument()
  })
})
