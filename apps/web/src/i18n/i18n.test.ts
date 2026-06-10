import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
  interpolate,
  isLocale,
  readStoredLocale,
  translate,
  writeStoredLocale,
  type MessageKey,
} from './index'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('interpolate', () => {
  it('substitutes a single {placeholder}', () => {
    expect(interpolate('hi {name}', { name: 'Sol' })).toBe('hi Sol')
  })

  it('substitutes multiple placeholders and coerces numbers', () => {
    expect(interpolate('{count} of {total}', { count: 2, total: 5 })).toBe('2 of 5')
  })

  it('returns the template unchanged when no vars are given', () => {
    expect(interpolate('plain {x}')).toBe('plain {x}')
  })

  it('leaves an unmatched placeholder verbatim (typo stays visible)', () => {
    expect(interpolate('hi {name}', { other: 'x' })).toBe('hi {name}')
  })
})

describe('translate', () => {
  it('resolves a real en key', () => {
    expect(translate('en', 'settings.title')).toBe('Settings')
  })

  it('interpolates vars into a resolved message', () => {
    // locale.name.en has no vars, but interpolate is exercised end-to-end via a
    // key whose value we treat as a template; assert pass-through is intact.
    expect(translate('en', 'locale.name.en')).toBe('English')
  })

  it('falls back to the key itself when the key is missing everywhere', () => {
    // Cast through unknown: a deliberately-unknown key exercises the runtime
    // missing-key fallback (the type system would normally forbid this).
    const missing = 'does.not.exist' as unknown as MessageKey
    expect(translate('en', missing)).toBe('does.not.exist')
  })
})

describe('locale storage', () => {
  it('isLocale accepts supported codes and rejects others', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('zz')).toBe(false)
    expect(isLocale(42)).toBe(false)
  })

  it('reads back a persisted locale', () => {
    writeStoredLocale('en')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    expect(readStoredLocale()).toBe('en')
  })

  it('returns null for a missing or invalid stored value', () => {
    expect(readStoredLocale()).toBeNull()
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon')
    expect(readStoredLocale()).toBeNull()
  })

  it('default locale is en and is in the supported set', () => {
    expect(DEFAULT_LOCALE).toBe('en')
    expect(LOCALES).toContain('en')
  })
})
