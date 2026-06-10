import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, apiPost, ApiError } from './apiFetch'
import { clearAuthToken, setAuthToken } from './authToken'

afterEach(() => {
  clearAuthToken()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('GETs a relative path under /api/agent-deck and returns parsed JSON', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const body = await apiFetch<{ ok: number }>('/models')
    expect(body).toEqual({ ok: 1 })
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/agent-deck/models')
  })

  it('passes an absolute /api path through unchanged', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/agent-deck/usage?days=7')
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/agent-deck/usage?days=7')
  })

  it('injects the bearer token from the locally saved token', async () => {
    setAuthToken('SECRET')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/models')
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.headers).toMatchObject({ Authorization: 'Bearer SECRET' })
  })

  it('sends no Authorization header on loopback (no saved token)', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/models')
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('throws an ApiError carrying status + code + message on a non-ok JSON response', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ code: 'sensitive', message: 'Sensitive file is blocked' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )

    const err = await apiFetch('/files/read').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 403,
      code: 'sensitive',
      message: 'Sensitive file is blocked',
    })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('oops', { status: 500 })),
    )
    const err = (await apiFetch('/models').catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)
    expect(err.message).toContain('500')
  })

  it('reads the error `error` field when `code` is absent', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    const err = (await apiFetch('/files').catch((e) => e)) as ApiError
    expect(err.code).toBe('forbidden')
  })

  it('forwards an AbortSignal to fetch', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await apiFetch('/models', { signal: controller.signal })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })

  it('lets a custom errorFactory shape the thrown error (Files keeps its named class)', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ code: 'x', message: 'boom' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    class Custom extends ApiError {}
    const err = await apiFetch('/files', {
      errorFactory: (m, s, code) => new Custom(m, s, code),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(Custom)
    expect(err).toMatchObject({ status: 404, code: 'x', message: 'boom' })
  })
})

describe('apiPost', () => {
  it('POSTs JSON with the right headers and parses the response', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ saved: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await apiPost<{ saved: boolean }>('/files/write', { path: 'a', content: 'b' })
    expect(res).toEqual({ saved: true })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/files/write')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(JSON.stringify({ path: 'a', content: 'b' }))
  })
})
