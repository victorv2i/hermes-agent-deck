import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Wordmark, BrandMark } from './Wordmark'

describe('Wordmark', () => {
  it('renders the "Agentdeck" accessible name in the real wordmark font', () => {
    render(<Wordmark />)
    const text = screen.getByText('Agentdeck')
    expect(text).toBeInTheDocument()
    // The text stays a real React span (PP Mondwest via font-wordmark), not baked
    // into the mark image — so it stays crisp + themeable.
    expect(text.className).toContain('font-wordmark')
  })

  it('renders the brand mark as the raster "AD" wing image (fixed identity), not an inline SVG', () => {
    const { container } = render(<BrandMark />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    // The fixed sky-blue identity image (the "AD" wing mark on transparent).
    expect(img).toHaveAttribute('src', '/brand-mark.png')
    // Decorative; the visible "Agentdeck" text carries the accessible name.
    expect(img).toHaveAttribute('alt', '')
    // It is a raster image now, not an inline vector.
    expect(container.querySelector('svg')).toBeNull()
  })

  it('keeps the mark a FIXED identity image — never the theme --primary accent', () => {
    const { container } = render(<BrandMark />)
    const img = container.querySelector('img')!
    // Unlike the former inline-SVG mark, the raster identity image does not follow
    // the theme and never carries the sky-blue accent (no text-primary / currentColor).
    expect(img.className).not.toContain('text-primary')
  })

  it('exposes the "Agentdeck" wordmark as the lockup accessible name', () => {
    render(<Wordmark />)
    expect(screen.getByText('Agentdeck')).toBeInTheDocument()
  })

  it('forwards className to the wrapper', () => {
    render(<Wordmark className="custom-x" />)
    const text = screen.getByText('Agentdeck')
    expect(text.parentElement).toHaveClass('custom-x')
  })
})
