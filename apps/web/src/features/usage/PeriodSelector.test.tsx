import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PeriodSelector } from './PeriodSelector'

/**
 * I5(b) a11y: the period selector is an ARIA radiogroup. It must implement the
 * roving-tabindex pattern (only the checked radio is in the tab order) and move
 * selection with ArrowLeft/ArrowRight (wrapping), per the WAI-ARIA radio group
 * keyboard contract.
 */
describe('PeriodSelector — radiogroup a11y', () => {
  it('uses roving tabindex: only the checked radio is tabbable', () => {
    render(<PeriodSelector value={14} onChange={() => {}} />)
    const radios = screen.getAllByRole('radio')
    const [seven, fourteen, thirty] = radios
    expect(fourteen).toHaveAttribute('aria-checked', 'true')
    expect(fourteen).toHaveAttribute('tabindex', '0')
    expect(seven).toHaveAttribute('tabindex', '-1')
    expect(thirty).toHaveAttribute('tabindex', '-1')
  })

  it('ArrowRight selects the next period', async () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={7} onChange={onChange} />)
    const seven = screen.getAllByRole('radio')[0]!
    seven.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith(14)
  })

  it('ArrowLeft wraps from the first to the last period', async () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={7} onChange={onChange} />)
    const seven = screen.getAllByRole('radio')[0]!
    seven.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenCalledWith(30)
  })

  it('gives each segment a 44px mobile touch target (relaxed on sm+)', () => {
    render(<PeriodSelector value={14} onChange={() => {}} />)
    for (const radio of screen.getAllByRole('radio')) {
      // min-h-11 (=44px) on mobile, dropped to sm:min-h-0 for compact desktop.
      expect(radio.className).toContain('min-h-11')
      expect(radio.className).toContain('sm:min-h-0')
    }
  })

  it('does not move selection when disabled', async () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={7} onChange={onChange} disabled />)
    const seven = screen.getAllByRole('radio')[0]!
    seven.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).not.toHaveBeenCalled()
  })
})
