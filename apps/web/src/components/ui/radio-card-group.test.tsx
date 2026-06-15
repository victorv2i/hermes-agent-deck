import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RadioCardGroup } from './radio-card-group'

const OPTIONS = [
  { value: 'mentor', label: 'Mentor', description: 'Guides and teaches' },
  { value: 'builder', label: 'Builder', description: 'Ships fast' },
]

describe('RadioCardGroup', () => {
  it('renders a radiogroup with labels and descriptions', () => {
    render(
      <RadioCardGroup aria-label="Soul" value="mentor" onValueChange={() => {}} options={OPTIONS} />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Soul' })).toBeInTheDocument()
    expect(screen.getByText('Guides and teaches')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('marks the selected card with the neutral identity ring, never the action accent', () => {
    render(
      <RadioCardGroup aria-label="Soul" value="mentor" onValueChange={() => {}} options={OPTIONS} />,
    )
    const selected = screen.getByRole('radio', { name: /Mentor/ })
    expect(selected).toHaveAttribute('aria-checked', 'true')
    expect(selected.className).toContain('border-[var(--border-strong)]')
    expect(selected.className).not.toContain('border-primary')
    // the selection marker must not light up the amber action accent
    expect(selected.querySelector('.text-primary')).toBeNull()
  })

  it('calls onValueChange on click', () => {
    const onValueChange = vi.fn()
    render(
      <RadioCardGroup
        aria-label="Soul"
        value="mentor"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Builder/ }))
    expect(onValueChange).toHaveBeenCalledWith('builder')
  })

  it('moves selection with the arrow keys', () => {
    const onValueChange = vi.fn()
    render(
      <RadioCardGroup
        aria-label="Soul"
        value="mentor"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    )
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' })
    expect(onValueChange).toHaveBeenCalledWith('builder')
  })
})
