import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ChatImage } from './ChatImage'

function renderImage(props: Partial<React.ComponentProps<typeof ChatImage>> = {}) {
  return render(
    <ThemeProvider>
      <ChatImage src="https://example.com/cat.png" alt="a cat" {...props} />
    </ThemeProvider>,
  )
}

describe('ChatImage', () => {
  it('renders a constrained, lazily-loaded thumbnail with honest alt', () => {
    renderImage()
    const img = screen.getByRole('img', { name: 'a cat' })
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('src', 'https://example.com/cat.png')
    // The thumbnail is height-capped (constrained), not full-bleed.
    expect(img.className).toMatch(/max-h-/)
  })

  it('is click-to-enlarge (wrapped in the lightbox trigger button)', () => {
    renderImage()
    expect(screen.getByRole('button', { name: /enlarge image: a cat/i })).toBeInTheDocument()
  })

  it('falls back to an honest link on load error — never a broken-image glyph', () => {
    renderImage()
    const img = screen.getByRole('img', { name: 'a cat' })
    fireEvent.error(img)
    // The <img> is gone; an honest link to the source is shown instead.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'a cat' })
    expect(link).toHaveAttribute('href', 'https://example.com/cat.png')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('degrades a broken data: URL to a quiet note (no openable link)', () => {
    renderImage({ src: 'data:image/png;base64,BROKEN', alt: 'pasted shot' })
    const img = screen.getByRole('img', { name: 'pasted shot' })
    fireEvent.error(img)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('pasted shot')).toBeInTheDocument()
  })
})
