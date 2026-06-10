import { afterEach, describe, expect, it, vi } from 'vitest'
import { audioServeUrl, fetchAudioObjectUrl } from './api'
import { clearAuthToken, setAuthToken } from '@/lib/authToken'

afterEach(() => {
  clearAuthToken()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('audioServeUrl', () => {
  it('targets the BFF audio serve route with the filename encoded', () => {
    expect(audioServeUrl('audio_x.ogg')).toBe('/api/agent-deck/voice/audio/audio_x.ogg')
    // a filename with a space is encoded (defense in depth — the server still guards)
    expect(audioServeUrl('a b.mp3')).toBe('/api/agent-deck/voice/audio/a%20b.mp3')
  })
})

describe('fetchAudioObjectUrl (auth-gated playback)', () => {
  it('fetches the serve route WITH the bearer token and returns an object URL', async () => {
    setAuthToken('SECRET_TOKEN')
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:mock-audio')
    vi.stubGlobal('URL', { createObjectURL } as unknown as typeof URL)

    const url = await fetchAudioObjectUrl('audio_x.ogg')

    expect(url).toBe('blob:mock-audio')
    const [reqUrl, init] = fetchMock.mock.calls[0]!
    expect(String(reqUrl)).toContain('/api/agent-deck/voice/audio/audio_x.ogg')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SECRET_TOKEN' })
    expect(createObjectURL).toHaveBeenCalledWith(blob)
  })

  it('sends NO Authorization header on loopback (no saved token)', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/mpeg' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x') } as unknown as typeof URL)

    await fetchAudioObjectUrl('audio_y.mp3')
    const [, init] = fetchMock.mock.calls[0]!
    expect((init as RequestInit).headers).toEqual({})
  })

  it('throws a clean error on a non-2xx response', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: 'not_found', message: 'Audio note not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchAudioObjectUrl('nope.ogg')).rejects.toThrow('Audio note not found.')
  })
})
