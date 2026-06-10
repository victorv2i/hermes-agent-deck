import { describe, it, expect } from 'vitest'
import { extractUrls, firstUrl } from './detectUrls'

describe('extractUrls (terminal output URL detection)', () => {
  it('finds a bare http and https URL', () => {
    expect(extractUrls('serving on http://localhost:5173')).toEqual(['http://localhost:5173'])
    expect(extractUrls('open https://example.com/path')).toEqual(['https://example.com/path'])
  })

  it('finds multiple URLs in order', () => {
    expect(extractUrls('a http://a.dev and https://b.dev/x done')).toEqual([
      'http://a.dev',
      'https://b.dev/x',
    ])
  })

  it('trims trailing sentence punctuation', () => {
    expect(extractUrls('see http://localhost:3000.')).toEqual(['http://localhost:3000'])
    expect(extractUrls('(visit https://example.com),')).toEqual(['https://example.com'])
    expect(extractUrls('ready at https://x.dev!')).toEqual(['https://x.dev'])
  })

  it('keeps a balanced closing paren that is part of the path', () => {
    expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ])
  })

  it('preserves query strings and fragments', () => {
    expect(extractUrls('http://localhost:8080/app?tab=1#top')).toEqual([
      'http://localhost:8080/app?tab=1#top',
    ])
  })

  it('returns [] when there is no URL', () => {
    expect(extractUrls('just some plain output, no links here')).toEqual([])
    expect(extractUrls('')).toEqual([])
  })

  it('does NOT match schemeless hosts or non-http schemes in raw output', () => {
    // Terminal detection is conservative: only explicit http(s) runs become
    // clickable, so we never turn `example.com` or `ftp://…` prose into a link.
    expect(extractUrls('go to example.com now')).toEqual([])
    expect(extractUrls('ftp://files.example.com/x')).toEqual([])
  })

  it('firstUrl returns the first match or null', () => {
    expect(firstUrl('a http://a.dev b http://b.dev')).toBe('http://a.dev')
    expect(firstUrl('nothing here')).toBeNull()
  })
})
