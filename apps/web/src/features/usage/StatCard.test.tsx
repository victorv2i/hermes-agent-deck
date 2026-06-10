import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatCard } from './StatCard'

describe('StatCard', () => {
  it('renders the label, value, and sub line', () => {
    render(<StatCard label="Total tokens" value="25.5K" sub="25,500 total" />)
    expect(screen.getByText('Total tokens')).toBeInTheDocument()
    expect(screen.getByText('25.5K')).toBeInTheDocument()
    expect(screen.getByText('25,500 total')).toBeInTheDocument()
  })

  it('renders no info affordance when none is given', () => {
    render(<StatCard label="Sessions" value="8" />)
    expect(screen.queryByRole('button', { name: /about sessions/i })).not.toBeInTheDocument()
  })

  it('exposes an accessible, focusable info affordance carrying the explanation', () => {
    render(
      <StatCard label="Est. cost" value="$0.63" info="Estimated from configured rate cards." />,
    )
    const info = screen.getByRole('button', { name: /about est\. cost/i })
    expect(info).toBeInTheDocument()
    // Keyboard-reachable (not tabindex -1), and the explanation is discoverable
    // via the native title for hover + the accessible description.
    expect(info).not.toHaveAttribute('tabindex', '-1')
    expect(info).toHaveAttribute('title', 'Estimated from configured rate cards.')
  })
})
