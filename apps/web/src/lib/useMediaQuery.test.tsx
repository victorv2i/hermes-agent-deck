import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery, useTouchInput } from './useMediaQuery'

type Listener = () => void

function installMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<Listener>()
  const mql = {
    get matches() {
      return matches
    },
    media: '',
    onchange: null,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => true,
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

describe('useMediaQuery', () => {
  beforeEach(() => {
    // restored per-test below
  })

  it('returns the initial match state', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'))
    expect(result.current).toBe(true)
  })

  it('updates when the media query changes', () => {
    const ctl = installMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'))
    expect(result.current).toBe(false)
    act(() => ctl.set(true))
    expect(result.current).toBe(true)
  })
})

describe('useTouchInput', () => {
  function setMaxTouchPoints(value: number) {
    Object.defineProperty(navigator, 'maxTouchPoints', { value, configurable: true })
  }

  afterEach(() => {
    // Drop the own property so the jsdom prototype default (0) applies again.
    delete (navigator as unknown as Record<string, unknown>).maxTouchPoints
  })

  it('is false with a fine pointer and no touch points (desktop)', () => {
    installMatchMedia(false)
    setMaxTouchPoints(0)
    const { result } = renderHook(() => useTouchInput())
    expect(result.current).toBe(false)
  })

  it('is true on a coarse primary pointer (phone/tablet)', () => {
    installMatchMedia(true)
    setMaxTouchPoints(0)
    const { result } = renderHook(() => useTouchInput())
    expect(result.current).toBe(true)
  })

  it('is true when touch points exist even with a fine pointer (hybrid laptop)', () => {
    installMatchMedia(false)
    setMaxTouchPoints(2)
    const { result } = renderHook(() => useTouchInput())
    expect(result.current).toBe(true)
  })

  it('re-evaluates on a resize (e.g. a convertible switching modes)', () => {
    installMatchMedia(false)
    setMaxTouchPoints(0)
    const { result } = renderHook(() => useTouchInput())
    expect(result.current).toBe(false)
    setMaxTouchPoints(2)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(true)
  })

  it('re-evaluates when the pointer media query flips', () => {
    const ctl = installMatchMedia(false)
    setMaxTouchPoints(0)
    const { result } = renderHook(() => useTouchInput())
    expect(result.current).toBe(false)
    act(() => ctl.set(true))
    expect(result.current).toBe(true)
  })
})
