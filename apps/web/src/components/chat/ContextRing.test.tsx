import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContextRing } from './ContextRing'

describe('ContextRing — honesty (T2.10)', () => {
  it('renders nothing until there is a token count to report', () => {
    const { container } = render(<ContextRing tokens={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('labels honestly with tokens used (approximate) when no model limit is known', () => {
    // The dashboard model-state exposes no per-model context window, so the ring
    // must NOT claim a precise "% used" against a fictional 200k limit. It states
    // the token count and marks it approximate.
    render(<ContextRing tokens={12_500} />)
    const ring = screen.getByTestId('context-ring')
    const label = ring.getAttribute('aria-label') ?? ''
    expect(label).toMatch(/12\.5K tokens/i)
    expect(label).toMatch(/approx/i)
    // No false percentage in the honest (limit-less) mode.
    expect(label).not.toMatch(/%/)
    // And it advertises that it is NOT a precise proportion.
    expect(ring).toHaveAttribute('data-approx', 'true')
  })

  it('reports a real percentage only when a real model limit is supplied, in plain estimate language', () => {
    render(<ContextRing tokens={50_000} limit={200_000} />)
    const ring = screen.getByTestId('context-ring')
    const label = ring.getAttribute('aria-label') ?? ''
    // Plain language, hedged as an estimate — never a precision claim.
    expect(label).toMatch(/about 25% of memory used/i)
    expect(label).toMatch(/roughly 50K of 200K tokens/i)
    expect(ring).toHaveAttribute('data-fraction', '0.250')
    expect(ring).toHaveAttribute('data-approx', 'false')
  })

  it('clamps a fraction to 100% and flags danger past ~90%', () => {
    render(<ContextRing tokens={400_000} limit={200_000} />)
    const ring = screen.getByTestId('context-ring')
    expect(ring).toHaveAttribute('data-fraction', '1.000')
    expect(ring.getAttribute('aria-label')).toMatch(/about 100% of memory used/i)
  })

  it('never invents a percentage from a junk limit (zero / NaN / negative)', () => {
    for (const limit of [0, Number.NaN, -5]) {
      const { unmount } = render(<ContextRing tokens={12_500} limit={limit} />)
      const ring = screen.getByTestId('context-ring')
      expect(ring).toHaveAttribute('data-approx', 'true')
      expect(ring.getAttribute('aria-label')).not.toMatch(/%/)
      unmount()
    }
  })
})
