import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpeechSynthesis } from './useSpeechSynthesis'
import {
  installMockSpeechSynthesis,
  makeVoice,
  type MockSpeechSynthesis,
} from './mockSpeechSynthesis'

let teardown: (() => void) | null = null
let synth: MockSpeechSynthesis | null = null

function install(voices = [] as SpeechSynthesisVoice[]) {
  const handle = installMockSpeechSynthesis(voices)
  synth = handle.synth
  teardown = handle.teardown
  return handle.synth
}

afterEach(() => {
  teardown?.()
  teardown = null
  synth = null
  vi.restoreAllMocks()
})

describe('feature detection', () => {
  it('reports unsupported when speechSynthesis is absent', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    expect(result.current.supported).toBe(false)
  })

  it('speak() is an inert no-op when unsupported', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    expect(() => act(() => result.current.speak('hi'))).not.toThrow()
    expect(result.current.speaking).toBe(false)
  })

  it('reports supported when speechSynthesis + utterance exist', () => {
    install()
    const { result } = renderHook(() => useSpeechSynthesis())
    expect(result.current.supported).toBe(true)
  })
})

describe('speak / cancel', () => {
  beforeEach(() => {
    install()
  })

  it('speak() utters the text and sets speaking', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak('hello world'))
    expect(synth!.speak).toHaveBeenCalledOnce()
    expect(synth!.spoken.at(-1)!.text).toBe('hello world')
    expect(result.current.speaking).toBe(true)
  })

  it('speak() does nothing for empty text', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak(''))
    expect(synth!.speak).not.toHaveBeenCalled()
  })

  it('a new speak() cancels the prior utterance first', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak('first'))
    act(() => result.current.speak('second'))
    expect(synth!.cancel).toHaveBeenCalled()
    expect(synth!.spoken.at(-1)!.text).toBe('second')
  })

  it('cancel() stops speaking', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak('hello'))
    act(() => result.current.cancel())
    expect(synth!.cancel).toHaveBeenCalled()
    expect(result.current.speaking).toBe(false)
  })

  it('clears speaking when the utterance ends', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak('hello'))
    act(() => synth!.finishSpeaking())
    expect(result.current.speaking).toBe(false)
  })

  it('clears speaking on an utterance error', () => {
    const { result } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak('hello'))
    act(() => synth!.errorSpeaking())
    expect(result.current.speaking).toBe(false)
  })
})

describe('options', () => {
  it('applies rate, pitch and lang to the utterance', () => {
    install()
    const { result } = renderHook(() =>
      useSpeechSynthesis({ rate: 1.5, pitch: 0.8, lang: 'en-GB' }),
    )
    act(() => result.current.speak('hi'))
    const utt = synth!.spoken.at(-1)!
    expect(utt.rate).toBe(1.5)
    expect(utt.pitch).toBe(0.8)
    expect(utt.lang).toBe('en-GB')
  })

  it('uses a default rate/pitch of 1 when not given', () => {
    install()
    const { result } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak('hi'))
    const utt = synth!.spoken.at(-1)!
    expect(utt.rate).toBe(1)
    expect(utt.pitch).toBe(1)
  })

  it('selects a voice by voiceURI when available', () => {
    const voice = makeVoice('Google US English')
    install([voice])
    const { result } = renderHook(() => useSpeechSynthesis({ voiceURI: 'Google US English' }))
    act(() => result.current.speak('hi'))
    expect(synth!.spoken.at(-1)!.voice).toBe(voice)
  })

  it('exposes the available voices', () => {
    const voice = makeVoice('Voice A')
    install([voice])
    const { result } = renderHook(() => useSpeechSynthesis())
    expect(result.current.voices).toEqual([voice])
  })

  it('picks up voices that arrive asynchronously via voiceschanged', () => {
    const s = install([])
    const { result } = renderHook(() => useSpeechSynthesis())
    expect(result.current.voices).toEqual([])
    const late = makeVoice('Late Voice')
    act(() => s.setVoices([late]))
    expect(result.current.voices).toEqual([late])
  })
})

describe('unmount cleanup', () => {
  it('cancels any in-flight utterance on unmount', () => {
    install()
    const { result, unmount } = renderHook(() => useSpeechSynthesis())
    act(() => result.current.speak('hello'))
    synth!.cancel.mockClear()
    unmount()
    expect(synth!.cancel).toHaveBeenCalled()
  })
})
