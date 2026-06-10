import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSettings } from './useSettings'
import type { SettingsPayload } from './types'

/** A throwaway QueryClient per test (retries off so error cases resolve fast). */
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

const PAYLOAD: SettingsPayload = {
  editable: false,
  sections: [
    {
      category: 'general',
      fields: [
        {
          key: 'model',
          label: 'model',
          description: 'Default model',
          type: 'string',
          value: 'anthropic/claude',
          isSecret: false,
        },
      ],
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useSettings', () => {
  it('starts in a loading state then resolves to the payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })),
    )
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() })

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data).toEqual(PAYLOAD)
    expect(result.current.error).toBeNull()
  })

  it('surfaces an error state on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 502 })),
    )
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeTruthy()
  })

  it('refetches when reload() is called', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.reload()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })
})
