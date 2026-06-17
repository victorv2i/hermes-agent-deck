import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TriangleAlert, Inbox } from 'lucide-react'
import { ErrorState, EmptyState } from './state'

describe('ErrorState', () => {
  it('renders the title, message, and a governed outline retry button', async () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        icon={TriangleAlert}
        title="Couldn’t load configuration"
        description="Your agent didn’t respond."
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('Couldn’t load configuration')).toBeInTheDocument()
    expect(screen.getByText('Your agent didn’t respond.')).toBeInTheDocument()
    expect(
      screen.getByRole('alert', { name: 'Couldn’t load configuration' }),
    ).toHaveAccessibleDescription('Your agent didn’t respond.')

    const retry = screen.getByRole('button', { name: /retry/i })
    // Accent governance: the retry is the OUTLINE variant, never the raw action accent.
    expect(retry).toHaveAttribute('data-variant', 'outline')

    await userEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits the action when no onRetry is given', () => {
    render(<ErrorState icon={TriangleAlert} title="Down" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses the destructive tile tone by default', () => {
    const { container } = render(<ErrorState icon={TriangleAlert} title="Down" />)
    const tile = container.querySelector('[data-slot="state-icon"]')
    expect(tile?.className).toContain('text-destructive')
  })
})

describe('EmptyState', () => {
  it('renders a neutral (non-destructive) tile with a title and description', () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="No models configured" description="Add one to your config." />,
    )
    expect(screen.getByText('No models configured')).toBeInTheDocument()
    expect(screen.getByText('Add one to your config.')).toBeInTheDocument()
    const tile = container.querySelector('[data-slot="state-icon"]')
    expect(tile?.className).not.toContain('text-destructive')
    expect(container.firstElementChild).toHaveAttribute('aria-labelledby')
    expect(container.firstElementChild).toHaveAttribute('aria-describedby')
  })

  it('renders a custom action node when provided', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Nothing here"
        action={<button type="button">Do thing</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Do thing' })).toBeInTheDocument()
  })
})
