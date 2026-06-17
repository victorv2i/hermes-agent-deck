import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  mediaRecorderSupported,
  pickAudioMimeType,
  blobToDataUrl,
  PREFERRED_AUDIO_MIME_TYPES,
} from './mediaCapture'

describe('mediaRecorderSupported', () => {
  it('is true when getUserMedia + a MediaRecorder constructor are both present', () => {
    const nav = { mediaDevices: { getUserMedia: () => {} } }
    expect(mediaRecorderSupported(nav, function MediaRecorder() {})).toBe(true)
  })

  it('is false when getUserMedia is missing', () => {
    expect(mediaRecorderSupported({ mediaDevices: {} }, function MediaRecorder() {})).toBe(false)
    expect(mediaRecorderSupported({}, function MediaRecorder() {})).toBe(false)
  })

  it('is false when the MediaRecorder constructor is missing', () => {
    const nav = { mediaDevices: { getUserMedia: () => {} } }
    expect(mediaRecorderSupported(nav, undefined)).toBe(false)
  })

  it('is false in SSR (no navigator)', () => {
    expect(mediaRecorderSupported(undefined, function MediaRecorder() {})).toBe(false)
  })
})

describe('pickAudioMimeType', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the first preferred type the platform supports', () => {
    const supported = new Set(['audio/ogg;codecs=opus', 'audio/ogg'])
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => supported.has(t) })
    // webm variants are unsupported here, so the first ogg variant wins.
    expect(pickAudioMimeType()).toBe('audio/ogg;codecs=opus')
  })

  it('returns the top preference when everything is supported', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true })
    expect(pickAudioMimeType()).toBe(PREFERRED_AUDIO_MIME_TYPES[0])
  })

  it('returns "" (browser default) when none are supported', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false })
    expect(pickAudioMimeType()).toBe('')
  })

  it('returns "" when MediaRecorder is absent', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(pickAudioMimeType()).toBe('')
  })
})

describe('blobToDataUrl', () => {
  it('encodes a blob as a base64 data URL', async () => {
    const blob = new Blob(['hello'], { type: 'audio/webm' })
    const url = await blobToDataUrl(blob)
    expect(url).toMatch(/^data:audio\/webm;base64,/)
  })
})
