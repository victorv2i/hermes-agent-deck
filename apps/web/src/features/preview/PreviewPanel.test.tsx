import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { PreviewPanel } from './PreviewPanel'
import { usePreviewStore } from './previewStore'

function reset() {
  usePreviewStore.setState({ open: true, url: null, status: 'idle', nonce: 0 })
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    reset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('shows the empty state when no URL is set', () => {
    render(<PreviewPanel open />)
    expect(screen.getByTestId('preview-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument()
  })

  it('always shows the honest same-machine reachability note', () => {
    render(<PreviewPanel open />)
    expect(screen.getByText(/host-local URL \(localhost\) loads/i)).toBeInTheDocument()
    expect(screen.getByText(/remote \(Tailscale\) browser would need a proxy/i)).toBeInTheDocument()
  })

  it('renders an iframe with a sane sandbox + no-referrer for a set URL', () => {
    act(() => usePreviewStore.getState().openUrl('http://localhost:3000'))
    render(<PreviewPanel open />)
    const frame = screen.getByTestId('preview-iframe') as HTMLIFrameElement
    expect(frame).toHaveAttribute('src', 'http://localhost:3000/')
    const sandbox = frame.getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-same-origin')
    expect(sandbox).toContain('allow-forms')
    // Critically must NOT let the framed page navigate Agent Deck away.
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('flips to the honest BLOCKED fallback when the load times out (never blank)', () => {
    act(() => usePreviewStore.getState().openUrl('https://denied.example.com'))
    render(<PreviewPanel open />)
    // Loading: the iframe is mounted, no blocked state yet.
    expect(screen.getByTestId('preview-iframe')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-blocked')).not.toBeInTheDocument()

    // The site never fires `load` (X-Frame-Options / CSP) → the timeout fires.
    act(() => {
      vi.advanceTimersByTime(8000)
    })

    const blocked = screen.getByTestId('preview-blocked')
    expect(blocked).toBeInTheDocument()
    expect(blocked).toHaveTextContent(/can't be previewed inline/i)
    // The escape hatch is present, never a silent blank panel.
    expect(screen.getByTestId('preview-blocked-external')).toBeInTheDocument()
    // And the iframe is gone (replaced by the fallback).
    expect(screen.queryByTestId('preview-iframe')).not.toBeInTheDocument()
  })

  it('a real iframe load before the timeout resolves to loaded (no false blocked)', () => {
    act(() => usePreviewStore.getState().openUrl('http://localhost:5173'))
    render(<PreviewPanel open />)
    const frame = screen.getByTestId('preview-iframe')

    // The dev server painted: fire the iframe load event.
    act(() => {
      fireEvent.load(frame)
    })
    expect(usePreviewStore.getState().status).toBe('loaded')

    // Even if the timeout window elapses afterwards, it must NOT flip to blocked.
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(screen.queryByTestId('preview-blocked')).not.toBeInTheDocument()
    expect(usePreviewStore.getState().status).toBe('loaded')
  })

  it('does NOT arm the blocked timeout while the panel is closed', () => {
    act(() => usePreviewStore.getState().openUrl('https://denied.example.com'))
    render(<PreviewPanel open={false} />)
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    // Closed panels don't probe; status stays loading until the panel is shown.
    expect(usePreviewStore.getState().status).toBe('loading')
  })

  it('the close control hides the panel via the store', () => {
    act(() => usePreviewStore.getState().openUrl('https://example.com'))
    render(<PreviewPanel open />)
    fireEvent.click(screen.getByTestId('preview-close'))
    expect(usePreviewStore.getState().open).toBe(false)
  })

  it('submitting the address bar navigates the iframe (bare host → https)', () => {
    render(<PreviewPanel open />)
    const input = screen.getByTestId('preview-address') as HTMLInputElement
    // Type a bare host then submit the address form; normalizeUrl adds https://.
    fireEvent.change(input, { target: { value: 'localhost:3000' } })
    fireEvent.submit(input.closest('form')!)
    expect(usePreviewStore.getState().url).toBe('https://localhost:3000/')
    expect(usePreviewStore.getState().status).toBe('loading')
  })

  it('open-in-new-tab uses a safe noopener window for the current URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    act(() => usePreviewStore.getState().openUrl('https://example.com'))
    render(<PreviewPanel open />)
    fireEvent.click(screen.getByTestId('preview-open-external'))
    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })
})
