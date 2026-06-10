import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  DENSITY_STORAGE_KEY,
  applyDensity,
  getDensity,
  readStoredDensity,
  setDensity,
  useDensity,
  type Density,
} from './density'

function clearAttr() {
  document.documentElement.removeAttribute('data-density')
}

beforeEach(() => {
  localStorage.clear()
  clearAttr()
  // Reset the module store to the comfortable baseline so tests don't leak the
  // module-level `current` value between them.
  setDensity('comfortable')
  localStorage.clear()
})

afterEach(() => {
  setDensity('comfortable')
  localStorage.clear()
  clearAttr()
  vi.restoreAllMocks()
})

describe('density storage', () => {
  it('reads a valid stored density', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, 'compact')
    expect(readStoredDensity()).toBe('compact')
  })

  it('returns null for a missing or invalid stored value', () => {
    expect(readStoredDensity()).toBeNull()
    localStorage.setItem(DENSITY_STORAGE_KEY, 'cozy')
    expect(readStoredDensity()).toBeNull()
  })

  it('defaults to comfortable when nothing is stored', () => {
    expect(getDensity()).toBe('comfortable')
  })

  it('reflects a set compact value in getDensity()', () => {
    setDensity('compact')
    expect(getDensity()).toBe('compact')
  })
})

describe('applyDensity', () => {
  it('sets data-density on <html> for compact', () => {
    applyDensity('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
  })

  it('removes the attribute for the comfortable default (clean DOM)', () => {
    applyDensity('compact')
    applyDensity('comfortable')
    expect(document.documentElement.hasAttribute('data-density')).toBe(false)
  })
})

describe('setDensity', () => {
  it('persists and applies the chosen density', () => {
    setDensity('compact')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
    expect(getDensity()).toBe('compact')
  })

  it('flipping back to comfortable persists and clears the attribute', () => {
    setDensity('compact')
    setDensity('comfortable')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('comfortable')
    expect(document.documentElement.hasAttribute('data-density')).toBe(false)
  })
})

describe('useDensity', () => {
  it('exposes the current density and updates on change', () => {
    const { result } = renderHook(() => useDensity())
    expect(result.current.density).toBe('comfortable')

    act(() => result.current.setDensity('compact'))
    expect(result.current.density).toBe('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
  })

  it('reflects an external setDensity() call (shared subscription)', () => {
    const { result } = renderHook(() => useDensity())
    act(() => setDensity('compact'))
    expect(result.current.density).toBe('compact')
  })

  it('keeps two hook instances in sync', () => {
    const a = renderHook(() => useDensity())
    const b = renderHook(() => useDensity())
    act(() => a.result.current.setDensity('compact'))
    expect(b.result.current.density).toBe('compact')
  })

  it('toggle() flips between the two densities', () => {
    const { result } = renderHook(() => useDensity())
    act(() => result.current.toggle())
    expect(result.current.density satisfies Density).toBe('compact')
    act(() => result.current.toggle())
    expect(result.current.density).toBe('comfortable')
  })
})
