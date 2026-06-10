import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ReasoningVerbosityControl } from './ReasoningVerbosityControl'
import { setVerbosity } from '@/features/reasoning/reasoningPrefs'

beforeEach(() => {
  localStorage.clear()
  setVerbosity('calm')
  localStorage.clear()
})

afterEach(() => {
  setVerbosity('calm')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ReasoningVerbosityControl — mobile a11y', () => {
  it('gives each verbosity segment a 44px mobile touch target (relaxed on sm+)', () => {
    render(<ReasoningVerbosityControl />)
    const group = screen.getByRole('radiogroup', { name: /reasoning detail/i })
    for (const radio of within(group).getAllByRole('radio')) {
      // min-h-11 (=44px) on mobile, dropped to sm:min-h-0 for compact desktop.
      expect(radio.className).toContain('min-h-11')
      expect(radio.className).toContain('sm:min-h-0')
    }
  })
})
