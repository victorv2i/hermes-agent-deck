import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadFile, fetchRawImageObjectUrl, FilesApiError } from './api'
import { clearAuthToken, setAuthToken } from '@/lib/authToken'

afterEach(() => {
  clearAuthToken()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('fetchRawImageObjectUrl (C1: authenticated image preview)', () => {
  it('fetches the raw route WITH the bearer token and returns an object URL', async () => {
    // Simulate a gated bind: the user entered the token, so authHeaders() must
    // put it on the raw-image fetch (an <img src> could not).
    setAuthToken('SECRET_TOKEN')
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    vi.stubGlobal('URL', { createObjectURL } as unknown as typeof URL)

    const url = await fetchRawImageObjectUrl('projects', 'pic.png')

    expect(url).toBe('blob:mock-url')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [reqUrl, init] = fetchMock.mock.calls[0]!
    expect(String(reqUrl)).toContain('/api/agent-deck/files/raw')
    expect(String(reqUrl)).toContain('path=pic.png')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer SECRET_TOKEN',
    })
    expect(createObjectURL).toHaveBeenCalledWith(blob)
  })

  it('sends NO Authorization header on loopback (no saved token)', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x') } as unknown as typeof URL)

    await fetchRawImageObjectUrl('projects', 'pic.png')

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('surfaces a FilesApiError on a non-ok response (e.g. 403 sensitive)', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'forbidden', message: 'Sensitive file is blocked' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(fetchRawImageObjectUrl('projects', 'secret.png')).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<FilesApiError>)
  })
})

describe('downloadFile (guarded attachment download)', () => {
  it('fetches the download route WITH auth and saves via a transient anchor', async () => {
    setAuthToken('SECRET_TOKEN')
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:dl')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as unknown as typeof URL)
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    await downloadFile('projects', 'docs/report.csv', 'report.csv')

    const [reqUrl, init] = fetchMock.mock.calls[0]!
    expect(String(reqUrl)).toContain('/api/agent-deck/files/download')
    expect(String(reqUrl)).toContain('path=docs%2Freport.csv')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SECRET_TOKEN' })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // The object URL is revoked after the click (no blob leak).
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dl')

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('throws a FilesApiError on a non-ok download (e.g. 403 sensitive)', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'forbidden', message: 'Sensitive file is blocked' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(downloadFile('projects', 'secret.env', 'secret.env')).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<FilesApiError>)
  })
})
