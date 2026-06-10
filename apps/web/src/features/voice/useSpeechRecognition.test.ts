import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpeechRecognition } from './useSpeechRecognition'
import { MockSpeechRecognition, installMockSpeechRecognition } from './mockSpeechRecognition'

let teardown: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  teardown?.()
  teardown = null
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('feature detection', () => {
  it('reports unsupported when no SpeechRecognition exists', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.supported).toBe(false)
  })

  it('start() is an inert no-op when unsupported', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    expect(result.current.recording).toBe(false)
  })

  it('detects the standard SpeechRecognition', () => {
    teardown = installMockSpeechRecognition()
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.supported).toBe(true)
  })

  it('detects the webkit-prefixed constructor', () => {
    teardown = installMockSpeechRecognition({ webkit: true })
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.supported).toBe(true)
  })
})

describe('start / stop lifecycle', () => {
  beforeEach(() => {
    teardown = installMockSpeechRecognition()
  })

  it('start() begins recording and configures interim results', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    expect(result.current.recording).toBe(true)
    const inst = MockSpeechRecognition.last!
    expect(inst.start).toHaveBeenCalledOnce()
    expect(inst.interimResults).toBe(true)
    expect(inst.continuous).toBe(true)
  })

  it('uses the provided language', () => {
    const { result } = renderHook(() => useSpeechRecognition({ lang: 'es-ES' }))
    act(() => result.current.start())
    expect(MockSpeechRecognition.last!.lang).toBe('es-ES')
  })

  it('stop() ends recording', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => result.current.stop())
    expect(MockSpeechRecognition.last!.stop).toHaveBeenCalledOnce()
    expect(result.current.recording).toBe(false)
  })

  it('abort() ends recording immediately', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => result.current.abort())
    expect(MockSpeechRecognition.last!.abort).toHaveBeenCalledOnce()
    expect(result.current.recording).toBe(false)
  })

  it('a second start() while recording does not create a new recognition', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => result.current.start())
    expect(MockSpeechRecognition.instances).toHaveLength(1)
  })
})

describe('transcript streaming', () => {
  beforeEach(() => {
    teardown = installMockSpeechRecognition()
  })

  it('streams interim then final transcript via onResult', () => {
    const onResult = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onResult }))
    act(() => result.current.start())

    act(() => {
      MockSpeechRecognition.last!.emitResult([{ transcript: 'hello ', isFinal: false }])
    })
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcript: 'hello ',
        interimTranscript: 'hello ',
        isFinal: false,
      }),
    )

    act(() => {
      MockSpeechRecognition.last!.emitResult([{ transcript: 'hello world', isFinal: true }])
    })
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcript: 'hello world',
        finalTranscript: 'hello world',
        interimTranscript: '',
        isFinal: true,
      }),
    )
  })

  it('concatenates multiple final results', () => {
    const onResult = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onResult }))
    act(() => result.current.start())
    act(() => {
      MockSpeechRecognition.last!.emitResult([
        { transcript: 'one ', isFinal: true },
        { transcript: 'two', isFinal: false },
      ])
    })
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ finalTranscript: 'one ', interimTranscript: 'two' }),
    )
  })
})

describe('auto-stop on silence', () => {
  beforeEach(() => {
    teardown = installMockSpeechRecognition()
  })

  it('auto-stops after the silence window with no results', () => {
    const { result } = renderHook(() => useSpeechRecognition({ silenceMs: 2000 }))
    act(() => result.current.start())
    expect(result.current.recording).toBe(true)
    act(() => vi.advanceTimersByTime(2000))
    expect(MockSpeechRecognition.last!.stop).toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
  })

  it('resets the silence timer on each result', () => {
    const { result } = renderHook(() => useSpeechRecognition({ silenceMs: 2000 }))
    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(1500))
    act(() => {
      MockSpeechRecognition.last!.emitResult([{ transcript: 'still talking', isFinal: false }])
    })
    act(() => vi.advanceTimersByTime(1500))
    expect(MockSpeechRecognition.last!.stop).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(600))
    expect(MockSpeechRecognition.last!.stop).toHaveBeenCalled()
  })

  it('does not auto-stop when silenceMs is 0', () => {
    const { result } = renderHook(() => useSpeechRecognition({ silenceMs: 0 }))
    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(10_000))
    expect(MockSpeechRecognition.last!.stop).not.toHaveBeenCalled()
  })
})

describe('error / permission handling', () => {
  beforeEach(() => {
    teardown = installMockSpeechRecognition()
  })

  it('surfaces a permission denial gracefully', () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onError }))
    act(() => result.current.start())
    act(() => {
      MockSpeechRecognition.last!.emitError('not-allowed')
    })
    expect(result.current.error).toBe('not-allowed')
    expect(onError).toHaveBeenCalledWith('not-allowed')
  })

  it('clears a prior error on the next start()', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => {
      MockSpeechRecognition.last!.emitError('network')
    })
    act(() => {
      MockSpeechRecognition.last!.emitEnd()
    })
    expect(result.current.error).toBe('network')
    act(() => result.current.start())
    expect(result.current.error).toBeNull()
  })

  it('calls onEnd when recognition ends on its own', () => {
    const onEnd = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onEnd }))
    act(() => result.current.start())
    act(() => {
      MockSpeechRecognition.last!.emitEnd()
    })
    expect(onEnd).toHaveBeenCalledOnce()
    expect(result.current.recording).toBe(false)
  })
})

describe('unmount cleanup', () => {
  beforeEach(() => {
    teardown = installMockSpeechRecognition()
  })

  it('aborts a live session on unmount', () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    const inst = MockSpeechRecognition.last!
    unmount()
    expect(inst.abort).toHaveBeenCalled()
  })
})
