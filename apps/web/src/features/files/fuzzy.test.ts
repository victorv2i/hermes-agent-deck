import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches everything for an empty query', () => {
    expect(fuzzyMatch('README.md', '')).toBe(true)
    expect(fuzzyMatch('', '')).toBe(true)
  })

  it('matches an in-order subsequence (not just a substring)', () => {
    // "readme.md": r(0) → m(4) → e(5) is a valid in-order subsequence.
    expect(fuzzyMatch('README.md', 'rme')).toBe(true)
  })

  it('respects character order', () => {
    // "rdm": r(0) → d(3) → m(4) is in order; "mr" would need m before r, which
    // never happens in "readme.md".
    expect(fuzzyMatch('README.md', 'rdm')).toBe(true)
    expect(fuzzyMatch('README.md', 'mr')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('CodeEditor.tsx', 'cet')).toBe(true)
    expect(fuzzyMatch('codeeditor.tsx', 'CET')).toBe(true)
  })

  it('returns false when a query character is absent', () => {
    expect(fuzzyMatch('src', 'srz')).toBe(false)
    expect(fuzzyMatch('notes.md', 'zzz')).toBe(false)
  })

  it('matches a plain contiguous substring', () => {
    expect(fuzzyMatch('package.json', 'json')).toBe(true)
  })
})
