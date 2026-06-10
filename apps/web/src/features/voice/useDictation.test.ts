import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDictation } from './useDictation'
import { installMockSpeechRecognition, MockSpeechRecognition } from './mockSpeechRecognition'

/**
 * useDictation wraps the existing useSpeechRecognition with the HONEST
 * availability gate the composer needs: dictation is offered only when the
 * Web Speech API is present AND the page is a secure context (voice input
 * requires https/localhost). When it can't run, the hook reports `available:
 * false` plus a human `unavailableReason` so the caller can disable the mic
 * with a truthful tooltip rather than silently swallowing taps.
 */
describe('useDictation', () => {
  let teardown: (() => void) | null = null
  afterEach(() => {
    teardown?.()
    teardown = null
    vi.unstubAllGlobals()
  })

  /** Pin window.isSecureContext for a test (default jsdom is non-secure). */
  function setSecureContext(secure: boolean) {
    vi.stubGlobal('isSecureContext', secure)
  }

  it('is unavailable (with a reason) when the Web Speech API is absent', () => {
    setSecureContext(true)
    const { result } = renderHook(() => useDictation())
    expect(result.current.available).toBe(false)
    expect(result.current.unavailableReason).toMatch(/voice input/i)
  })

  it('is unavailable (with a secure-context reason) on a non-secure origin', () => {
    teardown = installMockSpeechRecognition()
    setSecureContext(false)
    const { result } = renderHook(() => useDictation())
    expect(result.current.available).toBe(false)
    expect(result.current.unavailableReason).toMatch(/secure|https/i)
  })

  it('is available when the API is present on a secure origin', () => {
    teardown = installMockSpeechRecognition()
    setSecureContext(true)
    const { result } = renderHook(() => useDictation())
    expect(result.current.available).toBe(true)
    expect(result.current.unavailableReason).toBeNull()
  })

  it('start() is a no-op when unavailable (no recognition is constructed)', () => {
    teardown = installMockSpeechRecognition()
    setSecureContext(false)
    const { result } = renderHook(() => useDictation())
    act(() => result.current.start())
    expect(MockSpeechRecognition.last).toBeUndefined()
    expect(result.current.recording).toBe(false)
  })

  it('streams the recognized transcript through onResult while recording', () => {
    teardown = installMockSpeechRecognition()
    setSecureContext(true)
    const onResult = vi.fn()
    const { result } = renderHook(() => useDictation({ onResult }))
    act(() => result.current.start())
    expect(result.current.recording).toBe(true)
    act(() =>
      MockSpeechRecognition.last!.emitResult([{ transcript: 'hello there', isFinal: true }]),
    )
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'hello there', isFinal: true }),
    )
  })

  it('stop() ends an in-flight session', () => {
    teardown = installMockSpeechRecognition()
    setSecureContext(true)
    const { result } = renderHook(() => useDictation())
    act(() => result.current.start())
    expect(result.current.recording).toBe(true)
    act(() => result.current.stop())
    expect(result.current.recording).toBe(false)
  })
})
