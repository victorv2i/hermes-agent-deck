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
      />,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText(/watching 2 schedules/)).toBeInTheDocument()
  })

  it('renders a Start a chat button that fires onStartChat', async () => {
    const onStartChat = vi.fn()
    render(
      <StudioLaunchpad status={{ tone: 'ok', label: 'Connected', facts: [] }} onStartChat={onStartChat} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /start a chat/i }))
    expect(onStartChat).toHaveBeenCalled()
  })

  it('still renders Start a chat when there is no status yet', () => {
    render(<StudioLaunchpad status={undefined} onStartChat={vi.fn()} />)
    expect(screen.getByRole('button', { name: /start a chat/i })).toBeInTheDocument()
  })
})
