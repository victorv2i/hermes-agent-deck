import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CliBrandMark } from './cliBrandIcons'

describe('CliBrandMark', () => {
  it('renders a brand SVG for each known CLI id (identity, not a lucide fallback)', () => {
    for (const cli of ['hermes', 'claude', 'codex', 'shell'] as const) {
      const { container, unmount } = render(<CliBrandMark cli={cli} className="size-4" />)
      // hermes renders an <img> (Nous-girl), others render <svg>
      const svg = container.querySelector('svg')
      const img = container.querySelector('img')
      expect(svg ?? img, `${cli} should render either an svg or img mark`).not.toBeNull()
      unmount()
    }
  })

  it('Hermes uses the Nous-girl image (not a monogram)', () => {
    const { container } = render(<CliBrandMark cli="hermes" className="size-4" />)
    const img = container.querySelector('img')
    expect(img, 'hermes should render an <img> for the Nous-girl mark').not.toBeNull()
    // The src points to the hermes brand image in /brands/
    expect(img?.getAttribute('src')).toMatch(/hermes/)
  })

  it('Codex uses the real @lobehub/icons Codex mark (not a monogram)', () => {
    const { container } = render(<CliBrandMark cli="codex" className="size-4" />)
    const svg = container.querySelector('svg')
    expect(svg, 'codex should render an svg mark').not.toBeNull()
    // Must not be the hand-drawn monogram "O" — the monogram is a text element
    // with a single letter; the real icon has a proper path
    const textEl = svg?.querySelector('text')
    expect(textEl, 'codex should not render a monogram text element').toBeNull()
  })

  it('brand marks render in their OWN brand color, never the amber --primary token', () => {
    // Identity is never the accent: the marks use pinned brand hex / currentColor,
    // and must not reference the sky-blue accent token.
    const { container } = render(
      <>
        <CliBrandMark cli="claude" />
        <CliBrandMark cli="codex" />
      </>,
    )
    const markup = container.innerHTML
    expect(markup).not.toMatch(/var\(--primary\)/)
    expect(markup).not.toMatch(/text-primary|fill-primary|bg-primary/)
  })

  it('the shell mark is a neutral line glyph (no pinned brand fill)', () => {
    const { container } = render(<CliBrandMark cli="shell" />)
    // Neutral glyphs use currentColor (lucide), not a hard brand hex.
    expect(container.innerHTML).not.toMatch(/#D97757/i)
  })
})
