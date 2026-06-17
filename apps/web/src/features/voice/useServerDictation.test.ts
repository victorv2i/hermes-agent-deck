import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useServerDictation } from './useServerDictation'

/**
 * useServerDictation records the mic (getUserMedia + MediaRecorder) and POSTs the
 * clip to the BFF for transcription — the durable any-browser voice path. A real
 * mic can't run headless, so we drive a controllable MediaRecorder mock and a
 * fake getUserMedia, and inject the transcribe call.
 */

/** A controllable MediaRecorder stand-in jsdom doesn't provide. */
class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  static last: MockMediaRecorder | undefined
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start = vi.fn(() => {
    this.state = 'recording'
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
    // The platform emits the buffered data, then fires onstop.
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) })
    this.onstop?.()
  })
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm'
    MockMediaRecorder.last = this
  }
}

/** A fake MediaStream whose tracks record stop() calls (mic-release assertion). */
function makeFakeStream() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  return { stream, stop }
}

let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  getUserMedia = vi.fn()
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  MockMediaRecorder.last = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useServerDictation', () => {
  it('reports supported when getUserMedia + MediaRecorder are present', () => {
    const { result } = renderHook(() => useServerDictation())
    expect(result.current.supported).toBe(true)
  })

  it('records, posts the clip, and delivers the transcript through onResult', async () => {
    const { stream } = makeFakeStream()
    getUserMedia.mockResolvedValue(stream)
    const transcribeImpl = vi.fn().mockResolvedValue({ transcript: 'typed by voice' })
    const onResult = vi.fn()
    const onEnd = vi.fn()

    const { result } = renderHook(() => useServerDictation({ onResult, onEnd, transcribeImpl }))

    await act(async () => {
      result.current.start()
    })
    // getUserMedia resolved → recorder started → recording true.
    await waitFor(() => expect(result.current.recording).toBe(true))
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })

    await act(async () => {
      result.current.stop()
    })

    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(onResult).toHaveBeenCalledWith({ transcript: 'typed by voice', isFinal: true })
    // The transcribe call received a base64 audio data URL.
    expect(transcribeImpl).toHaveBeenCalledTimes(1)
    const arg = transcribeImpl.mock.calls[0]![0] as { dataUrl: string }
    expect(arg.dataUrl).toMatch(/^data:.*;base64,/)
    expect(onEnd).toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
    expect(result.current.transcribing).toBe(false)
  })

  it('sets transcribing true between stop and the transcript arriving', async () => {
    const { stream } = makeFakeStream()
    getUserMedia.mockResolvedValue(stream)
    let resolveTranscribe: (v: { transcript: string }) => void = () => {}
    const transcribeImpl = vi.fn(
      () => new Promise<{ transcript: string }>((res) => (resolveTranscribe = res)),
    )
    const { result } = renderHook(() => useServerDictation({ transcribeImpl }))

    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.recording).toBe(true))
    await act(async () => {
      result.current.stop()
    })
    // Transcription is in flight (promise not resolved yet).
    await waitFor(() => expect(result.current.transcribing).toBe(true))
    await act(async () => {
      resolveTranscribe({ transcript: 'done' })
    })
    await waitFor(() => expect(result.current.transcribing).toBe(false))
  })

  it('surfaces a permission denial as the `not-allowed` code', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
    const onError = vi.fn()
    const { result } = renderHook(() => useServerDictation({ onError }))
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(onError).toHaveBeenCalledWith('not-allowed'))
    expect(result.current.error).toBe('not-allowed')
    expect(result.current.recording).toBe(false)
  })

  it('surfaces a transcription failure as `transcribe-failed`', async () => {
    const { stream } = makeFakeStream()
    getUserMedia.mockResolvedValue(stream)
    const transcribeImpl = vi.fn().mockRejectedValue(new Error('502'))
    const onError = vi.fn()
    const { result } = renderHook(() => useServerDictation({ onError, transcribeImpl }))

    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.recording).toBe(true))
    await act(async () => {
      result.current.stop()
    })
    await waitFor(() => expect(onError).toHaveBeenCalledWith('transcribe-failed'))
    expect(result.current.error).toBe('transcribe-failed')
  })

  it('abort() discards the recording without transcribing', async () => {
    const { stream, stop: trackStop } = makeFakeStream()
    getUserMedia.mockResolvedValue(stream)
    const transcribeImpl = vi.fn().mockResolvedValue({ transcript: 'should not happen' })
    const { result } = renderHook(() => useServerDictation({ transcribeImpl }))

    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.recording).toBe(true))
    await act(async () => {
      result.current.abort()
    })
    expect(transcribeImpl).not.toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
    // The mic track was released.
    expect(trackStop).toHaveBeenCalled()
  })
})
