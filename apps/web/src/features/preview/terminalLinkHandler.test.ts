import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { handleTerminalLink } from './terminalLinkHandler'
import { usePreviewStore } from './previewStore'

function reset() {
  usePreviewStore.setState({ open: false, url: null, status: 'idle', nonce: 0 })
}

/** A minimal MouseEvent stand-in carrying just the modifier flags we read. */
function evt(mods: Partial<MouseEvent> = {}): MouseEvent {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods } as MouseEvent
}

describe('handleTerminalLink (terminal URL → Preview panel)', () => {
  beforeEach(reset)
  afterEach(() => vi.restoreAllMocks())

  it('a plain click opens the terminal URL in the Preview panel', () => {
    handleTerminalLink(evt(), 'http://localhost:5173/')
    const s = usePreviewStore.getState()
    expect(s.open).toBe(true)
    expect(s.url).toBe('http://localhost:5173/')
    expect(s.status).toBe('loading')
  })

  it('a plain click on an EXTERNAL URL opens a new tab, NOT the Preview panel', () => {
    // Public sites set X-Frame-Options and dead-end the iframe, so a plain click
    // on a non-host-local URL goes straight to a native new tab.
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    handleTerminalLink(evt(), 'https://www.amazon.com/s?k=printer')
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.amazon.com/s?k=printer',
      '_blank',
      'noopener,noreferrer',
    )
    expect(usePreviewStore.getState().open).toBe(false)
  })

  it('a ⌘/Ctrl/Shift/Alt click opens a native new tab and does NOT route the panel', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      reset()
      openSpy.mockClear()
      handleTerminalLink(evt({ [mod]: true }), 'https://example.com')
      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
      expect(usePreviewStore.getState().open).toBe(false)
    }
  })
})
