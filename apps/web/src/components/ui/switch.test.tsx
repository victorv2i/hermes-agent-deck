import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Switch } from './switch'

describe('Switch', () => {
  it('renders a switch reflecting the checked state', () => {
    render(<Switch checked aria-label="Auto-speak" onCheckedChange={() => {}} />)
    expect(screen.getByRole('switch', { name: 'Auto-speak' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('toggles on click', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} aria-label="Auto-speak" onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('keeps a 44px touch target on mobile and the shared focus ring', () => {
    render(<Switch checked={false} aria-label="x" onCheckedChange={() => {}} />)
    const sw = screen.getByRole('switch')
    expect(sw.className).toContain('min-h-11')
    expect(sw.className).toContain('ad-focus')
  })

  it('does not fire when disabled', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} disabled aria-label="x" onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
