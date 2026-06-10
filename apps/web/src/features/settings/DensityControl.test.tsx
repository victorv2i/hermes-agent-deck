import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DensityControl } from './DensityControl'
import { setDensity } from './density'

beforeEach(() => {
  localStorage.clear()
  setDensity('comfortable')
  localStorage.clear()
})

afterEach(() => {
  setDensity('comfortable')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('DensityControl — mobile a11y', () => {
  it('gives each density segment a 44px mobile touch target (relaxed on sm+)', () => {
    render(<DensityControl />)
    const group = screen.getByRole('radiogroup', { name: 'Density' })
    for (const radio of within(group).getAllByRole('radio')) {
      // min-h-11 (=44px) on mobile, dropped to sm:min-h-0 for compact desktop.
      expect(radio.className).toContain('min-h-11')
      expect(radio.className).toContain('sm:min-h-0')
    }
  })
})
