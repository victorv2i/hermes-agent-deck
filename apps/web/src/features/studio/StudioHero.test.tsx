import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StudioHero } from './StudioHero'

describe('StudioHero', () => {
  it('renders a decorative band (aria-hidden) backed by the generated hero image', () => {
    const { container } = render(<StudioHero />)
    // Decorative: the band is hidden from assistive tech.
    const band = container.querySelector('[aria-hidden="true"]') as HTMLElement | null
    expect(band).not.toBeNull()
    // The pixel-art gateway is a BACKGROUND image (so it can cover-crop), not a
    // raster <img> in the accessibility/content tree.
    expect(container.querySelector('img')).toBeNull()
    expect(band!.style.backgroundImage).toContain('studio-hero-art')
  })

  it('covers the band and clips the overflow so the gateway fills it without letterboxing', () => {
    const { container } = render(<StudioHero />)
    const band = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(band.className).toContain('bg-cover')
    expect(band.className).toContain('overflow-hidden')
  })
})
