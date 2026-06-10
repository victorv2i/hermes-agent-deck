import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  REASONING_VERBOSITY_STORAGE_KEY,
  getVerbosity,
  readStoredVerbosity,
  setVerbosity,
  useReasoningVerbosity,
  type VerbosityMode,
} from './reasoningPrefs'

beforeEach(() => {
  localStorage.clear()
  // Reset the module store to the calm baseline so tests don't leak the
  // module-level `current` value between them.
  setVerbosity('calm')
  localStorage.clear()
})

afterEach(() => {
  setVerbosity('calm')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('reasoning-verbosity storage', () => {
  it('reads a valid stored verbosity', () => {
    localStorage.setItem(REASONING_VERBOSITY_STORAGE_KEY, 'detailed')
    expect(readStoredVerbosity()).toBe('detailed')
  })

  it('returns null for a missing or invalid stored value', () => {
    expect(readStoredVerbosity()).toBeNull()
    localStorage.setItem(REASONING_VERBOSITY_STORAGE_KEY, 'verbose')
    expect(readStoredVerbosity()).toBeNull()
  })

  it('defaults to calm when nothing is stored', () => {
    expect(getVerbosity()).toBe('calm')
  })

  it('reflects a set detailed value in getVerbosity()', () => {
    setVerbosity('detailed')
    expect(getVerbosity()).toBe('detailed')
  })
})

describe('setVerbosity', () => {
  it('persists the chosen verbosity', () => {
    setVerbosity('detailed')
    expect(localStorage.getItem(REASONING_VERBOSITY_STORAGE_KEY)).toBe('detailed')
    expect(getVerbosity()).toBe('detailed')
  })

  it('flipping back to calm persists', () => {
    setVerbosity('detailed')
    setVerbosity('calm')
    expect(localStorage.getItem(REASONING_VERBOSITY_STORAGE_KEY)).toBe('calm')
  })
})

describe('useReasoningVerbosity', () => {
  it('exposes the current verbosity and updates on change', () => {
    const { result } = renderHook(() => useReasoningVerbosity())
    expect(result.current.verbosity).toBe('calm')

    act(() => result.current.setVerbosity('detailed'))
    expect(result.current.verbosity).toBe('detailed')
  })

  it('reflects an external setVerbosity() call (shared subscription)', () => {
    const { result } = renderHook(() => useReasoningVerbosity())
    act(() => setVerbosity('detailed'))
    expect(result.current.verbosity).toBe('detailed')
  })

  it('keeps two hook instances in sync', () => {
    const a = renderHook(() => useReasoningVerbosity())
    const b = renderHook(() => useReasoningVerbosity())
    act(() => a.result.current.setVerbosity('detailed'))
    expect(b.result.current.verbosity).toBe('detailed')
  })

  it('toggle() flips between the two modes', () => {
    const { result } = renderHook(() => useReasoningVerbosity())
    act(() => result.current.toggle())
    expect(result.current.verbosity satisfies VerbosityMode).toBe('detailed')
    act(() => result.current.toggle())
    expect(result.current.verbosity).toBe('calm')
  })
})
