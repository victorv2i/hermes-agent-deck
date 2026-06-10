import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSelectedModel, SELECTED_MODEL_STORAGE_KEY } from './useSelectedModel'

/**
 * The composer's persisted model choice. Defaults to the gateway's active model,
 * remembers an explicit pick across reloads, and only honors a persisted choice
 * that still exists in the available list (a stale id falls back to active).
 */
describe('useSelectedModel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to the active model when nothing is persisted', () => {
    const { result } = renderHook(() => useSelectedModel(['a', 'b'], 'b'))
    expect(result.current.selected).toBe('b')
  })

  it('persists an explicit choice and reports it', () => {
    const { result } = renderHook(() => useSelectedModel(['a', 'b'], 'a'))
    act(() => result.current.select('b'))
    expect(result.current.selected).toBe('b')
    expect(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)).toBe('b')
  })

  it('restores a persisted choice on the next mount (over the active default)', () => {
    localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, 'a')
    const { result } = renderHook(() => useSelectedModel(['a', 'b'], 'b'))
    expect(result.current.selected).toBe('a')
  })

  it('ignores a persisted choice that is no longer available, falling back to active', () => {
    localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, 'gone')
    const { result } = renderHook(() => useSelectedModel(['a', 'b'], 'b'))
    expect(result.current.selected).toBe('b')
  })

  it('returns null when there are no models and no active model yet', () => {
    const { result } = renderHook(() => useSelectedModel([], null))
    expect(result.current.selected).toBeNull()
  })

  it('keeps an explicit choice valid even as the active model changes elsewhere', () => {
    const { result, rerender } = renderHook(
      ({ ids, active }: { ids: string[]; active: string | null }) => useSelectedModel(ids, active),
      { initialProps: { ids: ['a', 'b'], active: 'a' } },
    )
    act(() => result.current.select('b'))
    rerender({ ids: ['a', 'b'], active: 'a' })
    expect(result.current.selected).toBe('b')
  })
})
