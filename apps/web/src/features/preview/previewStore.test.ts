import { describe, it, expect, beforeEach } from 'vitest'
import { usePreviewStore, normalizeUrl } from './previewStore'

/** Reset the singleton store between tests. */
function resetStore() {
  usePreviewStore.setState({ open: false, url: null, status: 'idle', nonce: 0 })
}

describe('normalizeUrl', () => {
  it('keeps an explicit http/https URL', () => {
    expect(normalizeUrl('http://localhost:3000/')).toBe('http://localhost:3000/')
    expect(normalizeUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })

  it('assumes https for a schemeless host', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(normalizeUrl('localhost:5173/foo')).toBe('https://localhost:5173/foo')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com/')
  })

  it('rejects empty / whitespace-only input', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
  })

  it('rejects dangerous / un-previewable schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,<h1>x</h1>')).toBeNull()
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeUrl('mailto:a@b.com')).toBeNull()
    expect(normalizeUrl('about:blank')).toBeNull()
  })
})

describe('previewStore', () => {
  beforeEach(resetStore)

  it('opens a normalized URL into a loading state and bumps the nonce', () => {
    usePreviewStore.getState().openUrl('example.com/dev')
    const s = usePreviewStore.getState()
    expect(s.open).toBe(true)
    expect(s.url).toBe('https://example.com/dev')
    expect(s.status).toBe('loading')
    expect(s.nonce).toBe(1)
  })

  it('re-opening the SAME url still bumps the nonce (forces a real reload)', () => {
    const { openUrl } = usePreviewStore.getState()
    openUrl('http://localhost:3000')
    const firstNonce = usePreviewStore.getState().nonce
    usePreviewStore.getState().markLoaded()
    openUrl('http://localhost:3000')
    const s = usePreviewStore.getState()
    expect(s.nonce).toBe(firstNonce + 1)
    expect(s.status).toBe('loading')
  })

  it('ignores an un-previewable URL (no-op, panel stays as-is)', () => {
    usePreviewStore.getState().openUrl('javascript:alert(1)')
    const s = usePreviewStore.getState()
    expect(s.open).toBe(false)
    expect(s.url).toBeNull()
    expect(s.status).toBe('idle')
  })

  it('markLoaded resolves a loading iframe to loaded', () => {
    usePreviewStore.getState().openUrl('https://example.com')
    usePreviewStore.getState().markLoaded()
    expect(usePreviewStore.getState().status).toBe('loaded')
  })

  it('markBlocked surfaces a blocked iframe (the honest fallback state)', () => {
    usePreviewStore.getState().openUrl('https://example.com')
    usePreviewStore.getState().markBlocked()
    expect(usePreviewStore.getState().status).toBe('blocked')
  })

  it('a late markBlocked after the iframe already loaded does NOT clobber loaded', () => {
    // The load-timeout can race the real onLoad; a timeout firing AFTER a
    // successful load must not flip a good preview into the blocked fallback.
    usePreviewStore.getState().openUrl('https://example.com')
    usePreviewStore.getState().markLoaded()
    usePreviewStore.getState().markBlocked()
    expect(usePreviewStore.getState().status).toBe('loaded')
  })

  it('a late markLoaded after blocked does NOT resurrect a blocked load', () => {
    usePreviewStore.getState().openUrl('https://example.com')
    usePreviewStore.getState().markBlocked()
    usePreviewStore.getState().markLoaded()
    expect(usePreviewStore.getState().status).toBe('blocked')
  })

  it('close hides the panel but keeps the URL', () => {
    usePreviewStore.getState().openUrl('https://example.com')
    usePreviewStore.getState().close()
    const s = usePreviewStore.getState()
    expect(s.open).toBe(false)
    expect(s.url).toBe('https://example.com/')
  })

  it('reload re-enters loading + bumps the nonce + re-opens', () => {
    usePreviewStore.getState().openUrl('https://example.com')
    usePreviewStore.getState().markLoaded()
    usePreviewStore.getState().close()
    const before = usePreviewStore.getState().nonce
    usePreviewStore.getState().reload()
    const s = usePreviewStore.getState()
    expect(s.status).toBe('loading')
    expect(s.nonce).toBe(before + 1)
    expect(s.open).toBe(true)
  })

  it('reload with no URL is a no-op', () => {
    usePreviewStore.getState().reload()
    const s = usePreviewStore.getState()
    expect(s.status).toBe('idle')
    expect(s.nonce).toBe(0)
  })

  it('toggle flips open without requiring a URL', () => {
    usePreviewStore.getState().toggle()
    expect(usePreviewStore.getState().open).toBe(true)
    usePreviewStore.getState().toggle()
    expect(usePreviewStore.getState().open).toBe(false)
  })
})
