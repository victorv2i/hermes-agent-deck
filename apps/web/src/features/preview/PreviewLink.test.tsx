import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PreviewLink } from './PreviewLink'
import { usePreviewStore } from './previewStore'

function reset() {
  usePreviewStore.setState({ open: false, url: null, status: 'idle', nonce: 0 })
}

describe('PreviewLink (chat link → Preview panel)', () => {
  beforeEach(reset)

  it('a plain left click opens the http(s) link in the Preview panel', () => {
    render(<PreviewLink href="https://example.com/docs">docs</PreviewLink>)
    fireEvent.click(screen.getByTestId('preview-link'))
    const s = usePreviewStore.getState()
    expect(s.open).toBe(true)
    expect(s.url).toBe('https://example.com/docs')
  })

  it('does NOT hijack a modifier (⌘/Ctrl) click — native new-tab is preserved', () => {
    render(<PreviewLink href="https://example.com">site</PreviewLink>)
    const link = screen.getByTestId('preview-link')
    // A ⌘/Ctrl click should not preventDefault → the browser opens a new tab.
    const evt = fireEvent.click(link, { metaKey: true })
    expect(evt).toBe(true) // not cancelled
    expect(usePreviewStore.getState().open).toBe(false)

    const evt2 = fireEvent.click(link, { ctrlKey: true })
    expect(evt2).toBe(true)
    expect(usePreviewStore.getState().open).toBe(false)
  })

  it('keeps a real anchor (href + new-tab rel) so right-click/copy/AT still work', () => {
    render(<PreviewLink href="https://example.com">site</PreviewLink>)
    const link = screen.getByTestId('preview-link')
    expect(link).toHaveAttribute('href', 'https://example.com/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('exposes a small explicit "open in new tab" control that does NOT open the panel', () => {
    render(<PreviewLink href="https://example.com">site</PreviewLink>)
    const external = screen.getByTestId('preview-link-external')
    expect(external).toHaveAttribute('target', '_blank')
    fireEvent.click(external)
    // The external control opens a new tab natively; it must not route the panel.
    expect(usePreviewStore.getState().open).toBe(false)
  })

  it('falls back to a plain new-tab anchor for non-previewable links (mailto/anchor/relative)', () => {
    const openSpy = vi.spyOn(usePreviewStore.getState(), 'openUrl')
    const { rerender } = render(<PreviewLink href="mailto:a@b.com">mail</PreviewLink>)
    // No preview-link affordance — it's a plain anchor.
    expect(screen.queryByTestId('preview-link')).not.toBeInTheDocument()
    const mail = screen.getByText('mail').closest('a')!
    expect(mail).toHaveAttribute('href', 'mailto:a@b.com')

    rerender(<PreviewLink href="#section">anchor</PreviewLink>)
    expect(screen.queryByTestId('preview-link')).not.toBeInTheDocument()

    rerender(<PreviewLink href="/relative/path">rel</PreviewLink>)
    expect(screen.queryByTestId('preview-link')).not.toBeInTheDocument()

    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })
})
