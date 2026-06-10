import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, buttonVariants } from './button'

describe('Button pressed-state tactility', () => {
  it('renders a real pressed affordance (active scale) on the base variant', () => {
    render(<Button>Run</Button>)
    const btn = screen.getByRole('button', { name: 'Run' })
    // The press should physically depress the control, not just tint it.
    expect(btn.className).toContain('active:scale-[0.97]')
  })

  it('scopes the transition so transform composes with the color transitions', () => {
    // duration-100 keeps the press snappy; the property list must include
    // transform alongside the existing color transitions so they animate together.
    expect(buttonVariants()).toContain('transition-[transform,background-color,color]')
    expect(buttonVariants()).toContain('duration-100')
  })

  it('uses the canonical .ad-focus ring (consistent focus app-wide)', () => {
    // Focus is owned by the shared .ad-focus utility, replacing the ad-hoc
    // ring-3 / ring-ring/50 so focus looks identical across every primitive.
    const base = buttonVariants({ variant: 'outline' })
    expect(base).toContain('ad-focus')
    expect(base).not.toMatch(/focus-visible:ring-3\b/)
  })

  it('defaults native buttons to type="button" and marks aria-disabled inert', () => {
    render(<Button aria-disabled>Retry</Button>)
    const btn = screen.getByRole('button', { name: 'Retry' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn.className).toContain('aria-disabled:pointer-events-none')
    expect(btn.className).toContain('touch-manipulation')
  })
})
