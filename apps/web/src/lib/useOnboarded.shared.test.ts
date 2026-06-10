import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  ONBOARDED_KEY,
  readStoredOnboarded,
  getOnboardedSnapshot,
  markOnboarded,
  resetOnboarded,
  useOnboarded,
} from './useOnboarded'

/**
 * The DEFAULT (non-injected) path is backed by a module-level external store the
 * integrator's first-run landing logic shares with the Home route. Each test
 * resets it (clear storage + force the bit back to false) to stay hermetic.
 */
beforeEach(() => {
  localStorage.clear()
  resetOnboarded()
})

afterEach(() => {
  localStorage.clear()
  resetOnboarded()
})

describe('useOnboarded — shared store (default path)', () => {
  it('reads false on a fresh first run', () => {
    expect(readStoredOnboarded()).toBe(false)
    expect(getOnboardedSnapshot()).toBe(false)
  })

  it('default useOnboarded() reflects and persists the shared bit', () => {
    const { result } = renderHook(() => useOnboarded())
    expect(result.current[0]).toBe(false)

    act(() => {
      result.current[1]()
    })

    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem(ONBOARDED_KEY)).toBe('1')
    expect(readStoredOnboarded()).toBe(true)
  })

  it('notifies every default reader when the flag flips (one shared bit)', () => {
    const a = renderHook(() => useOnboarded())
    const b = renderHook(() => useOnboarded())
    expect(a.result.current[0]).toBe(false)
    expect(b.result.current[0]).toBe(false)

    act(() => {
      markOnboarded()
    })

    // The route reader AND the integrator's landing reader see the same bit.
    expect(a.result.current[0]).toBe(true)
    expect(b.result.current[0]).toBe(true)
  })

  it('is idempotent — marking twice stays true without throwing', () => {
    markOnboarded()
    markOnboarded()
    expect(getOnboardedSnapshot()).toBe(true)
  })
})
