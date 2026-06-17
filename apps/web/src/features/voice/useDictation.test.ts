import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDictation } from './useDictation'
import { installMockSpeechRecognition, MockSpeechRecognition } from './mockSpeechRecognition'

/**
 * useDictation picks the best dictation path and exposes ONE honest gate to the
 * composer:
 *  - NATIVE (Web Speech) when the API is present on a secure origin (fast path),
 *  - SERVER-STT (getUserMedia + MediaRecorder → BFF) when the Web Speech API is
 *    absent but mic capture is available on a secure origin (durable any-browser),
 *  - honest DISABLED otherwise, with a truthful `unavailableReason` (+ hint):
 *    insecure origin vs no capture support at all.
 *
 * A real mic can't run headless, so these cover the GATE + path SELECTION logic;
 * the server recording lifecycle is covered in useServerDictation.test.ts.
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

  /** Install fake getUserMedia + MediaRecorder so server-STT is "supported". */
  function installMediaCapture() {
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    class FakeRecorder {
      static isTypeSupported = () => true
      state: 'inactive' | 'recording' = 'inactive'
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      start = vi.fn(() => {
        this.state = 'recording'
      })
      stop = vi.fn(() => {
        this.state = 'inactive'
      })
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder)
  }

  describe('native fast path', () => {
    it('is available + mode "native" when the Web Speech API is present on a secure origin', () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(true)
      const { result } = renderHook(() => useDictation())
      expect(result.current.available).toBe(true)
      expect(result.current.mode).toBe('native')
      expect(result.current.unavailableReason).toBeNull()
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

    it('stop() ends an in-flight native session', () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(true)
      const { result } = renderHook(() => useDictation())
      act(() => result.current.start())
      expect(result.current.recording).toBe(true)
      act(() => result.current.stop())
      expect(result.current.recording).toBe(false)
    })
  })

  describe('server fallback path', () => {
    it('is available + mode "server" when Web Speech is absent but capture is present (secure)', () => {
      installMediaCapture()
      setSecureContext(true)
      const { result } = renderHook(() => useDictation())
      expect(result.current.available).toBe(true)
      expect(result.current.mode).toBe('server')
      expect(result.current.supported).toBe(false) // native Web Speech is absent
      expect(result.current.unavailableReason).toBeNull()
    })

    it('prefers native over server when BOTH are available', () => {
      teardown = installMockSpeechRecognition()
      installMediaCapture()
      setSecureContext(true)
      const { result } = renderHook(() => useDictation())
      expect(result.current.mode).toBe('native')
    })

    it('start() routes to the server recorder in server mode', async () => {
      installMediaCapture()
      setSecureContext(true)
      const { result } = renderHook(() => useDictation())
      await act(async () => {
        result.current.start()
      })
      // getUserMedia was invoked (the server path began capture).
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
    })
  })

  describe('honest disabled gate', () => {
    it('is unavailable with an https reason on a non-secure origin (even with capture)', () => {
      installMediaCapture()
      setSecureContext(false)
      const { result } = renderHook(() => useDictation())
      expect(result.current.available).toBe(false)
      expect(result.current.mode).toBeNull()
      expect(result.current.unavailableReason).toMatch(/https/i)
      expect(result.current.unavailableHint).toMatch(/https|address/i)
    })

    it('is unavailable with a "not supported" reason when no capture path exists (secure)', () => {
      // No native API, no mediaDevices/MediaRecorder (jsdom default).
      setSecureContext(true)
      const { result } = renderHook(() => useDictation())
      expect(result.current.available).toBe(false)
      expect(result.current.mode).toBeNull()
      expect(result.current.unavailableReason).toMatch(/support|browser/i)
    })

    it('start() is a no-op when unavailable (no recognition is constructed)', () => {
      teardown = installMockSpeechRecognition()
      setSecureContext(false)
      const { result } = renderHook(() => useDictation())
      act(() => result.current.start())
      expect(MockSpeechRecognition.last).toBeUndefined()
      expect(result.current.recording).toBe(false)
    })
  })
})
