import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  PALETTE_STORAGE_KEY,
  applyPalette,
  getPalette,
  readStoredPalette,
  setPalette,
  usePalette,
  type Palette,
} from './palette'
import { DEFAULT_PALETTE_ID } from './palette-registry'

function clearAttr() {
  document.documentElement.removeAttribute('data-palette')
}

beforeEach(() => {
  localStorage.clear()
  clearAttr()
  // Reset the module store to the default so tests don't leak the module-level
  // `current` value between them.
  setPalette(DEFAULT_PALETTE_ID)
  localStorage.clear()
})

afterEach(() => {
  setPalette(DEFAULT_PALETTE_ID)
  localStorage.clear()
  clearAttr()
  vi.restoreAllMocks()
})

describe('palette storage', () => {
  it('reads a valid stored palette', () => {
    localStorage.setItem(PALETTE_STORAGE_KEY, 'warm-void')
    expect(readStoredPalette()).toBe('warm-void')
  })

  it('returns null for a missing or invalid stored value', () => {
    expect(readStoredPalette()).toBeNull()
    localStorage.setItem(PALETTE_STORAGE_KEY, 'teal')
    expect(readStoredPalette()).toBeNull()
  })

  it('defaults to clay-sky when nothing is stored', () => {
    expect(getPalette()).toBe('clay-sky')
  })

  it('reflects a set value in getPalette()', () => {
    setPalette('indigo-atelier')
    expect(getPalette()).toBe('indigo-atelier')
  })
})

describe('applyPalette', () => {
  it('stamps data-palette on <html> for a non-default palette', () => {
    applyPalette('warm-void')
    expect(document.documentElement.getAttribute('data-palette')).toBe('warm-void')
  })

  it('removes the attribute for the default palette (clean DOM, bare :root)', () => {
    applyPalette('warm-void')
    applyPalette(DEFAULT_PALETTE_ID)
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false)
  })

  it('stamps each non-default family by id', () => {
    for (const id of ['warm-void', 'indigo-atelier'] as const) {
      applyPalette(id)
      expect(document.documentElement.getAttribute('data-palette')).toBe(id)
    }
  })
})

describe('setPalette', () => {
  it('persists and applies the chosen palette', () => {
    setPalette('warm-void')
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('warm-void')
    expect(document.documentElement.getAttribute('data-palette')).toBe('warm-void')
    expect(getPalette()).toBe('warm-void')
  })

  it('flipping back to the default persists and clears the attribute', () => {
    setPalette('warm-void')
    setPalette(DEFAULT_PALETTE_ID)
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe(DEFAULT_PALETTE_ID)
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false)
  })

  it('survives a throwing localStorage (still applies in-memory + attribute)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setPalette('indigo-atelier')).not.toThrow()
    expect(getPalette()).toBe('indigo-atelier')
    expect(document.documentElement.getAttribute('data-palette')).toBe('indigo-atelier')
  })
})

describe('usePalette', () => {
  it('exposes the current palette and updates on change', () => {
    const { result } = renderHook(() => usePalette())
    expect(result.current.palette).toBe('clay-sky')

    act(() => result.current.setPalette('warm-void'))
    expect(result.current.palette).toBe('warm-void')
    expect(document.documentElement.getAttribute('data-palette')).toBe('warm-void')
  })

  it('reflects an external setPalette() call (shared subscription)', () => {
    const { result } = renderHook(() => usePalette())
    act(() => setPalette('indigo-atelier'))
    expect(result.current.palette).toBe('indigo-atelier')
  })

  it('keeps two hook instances in sync', () => {
    const a = renderHook(() => usePalette())
    const b = renderHook(() => usePalette())
    act(() => a.result.current.setPalette('clay-sky'))
    expect(b.result.current.palette satisfies Palette).toBe('clay-sky')
  })
})
