import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './input'

describe('Input', () => {
  it('renders a native text input and forwards typed value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input aria-label="Name" onChange={onChange} />)
    const el = screen.getByRole('textbox', { name: 'Name' })
    await user.type(el, 'atlas')
    expect((el as HTMLInputElement).value).toBe('atlas')
    expect(onChange).toHaveBeenCalled()
  })

  it('reflects aria-invalid for live validation', () => {
    render(<Input aria-label="Name" aria-invalid />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('never paints the amber primary accent (identity/entry is not an action)', () => {
    const { container } = render(<Input aria-label="Name" />)
    const el = container.querySelector('input')!
    expect(el.className).not.toMatch(/(?:^|[\s:])(?:bg|text|border|ring)-primary\b/)
  })

  it('uses the canonical .ad-focus ring (consistent focus app-wide)', () => {
    const { container } = render(<Input aria-label="Name" />)
    const el = container.querySelector('input')!
    expect(el.className).toContain('ad-focus')
    // The ad-hoc ring width/alpha is gone — focus is owned by the shared utility.
    expect(el.className).not.toContain('ring-ring/40')
  })

  it('uses body typography by default but lets callers opt into monospace contexts', () => {
    const { container, rerender } = render(<Input aria-label="Name" />)
    let el = container.querySelector('input')!
    expect(el.className).not.toContain('font-mono')

    rerender(<Input aria-label="Path" className="font-mono" />)
    el = container.querySelector('input')!
    expect(el.className).toContain('font-mono')
  })

  it('uses the shared touch affordance for coarse pointers', () => {
    const { container } = render(<Input aria-label="Name" />)
    expect(container.querySelector('input')?.className).toContain('touch-manipulation')
  })
})
