import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBoardExpand } from './useBoardExpand'

afterEach(() => {
  document.body.style.overflow = ''
})

describe('useBoardExpand', () => {
  it('starts collapsed', () => {
    const { result } = renderHook(() => useBoardExpand())
    expect(result.current.expanded).toBe(false)
  })

  it('toggles expanded on and off', () => {
    const { result } = renderHook(() => useBoardExpand())
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(false)
  })

  it('collapse() is idempotent and returns to collapsed', () => {
    const { result } = renderHook(() => useBoardExpand())
    act(() => result.current.toggle())
    act(() => result.current.collapse())
    expect(result.current.expanded).toBe(false)
    act(() => result.current.collapse())
    expect(result.current.expanded).toBe(false)
  })

  it('Escape collapses when expanded', () => {
    const { result } = renderHook(() => useBoardExpand())
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.expanded).toBe(false)
  })

  it('Escape does nothing when already collapsed', () => {
    const { result } = renderHook(() => useBoardExpand())
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.expanded).toBe(false)
  })

  it('locks body scroll while expanded and restores it on collapse', () => {
    const { result } = renderHook(() => useBoardExpand())
    act(() => result.current.toggle())
    expect(document.body.style.overflow).toBe('hidden')
    act(() => result.current.collapse())
    expect(document.body.style.overflow).toBe('')
  })

  it('restores body scroll on unmount', () => {
    const { result, unmount } = renderHook(() => useBoardExpand())
    act(() => result.current.toggle())
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
