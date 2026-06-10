import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useProfiles } from './useProfiles'
import type { ProfilesResponse } from './types'

/** Wrap the hook in a throwaway QueryClient (retries off so error cases resolve
 * deterministically without the default one-retry backoff). */
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

const sample: ProfilesResponse = {
  active: 'coder',
  profiles: [
    {
      name: 'default',
      displayPath: 'Hermes home',
      isDefault: true,
      isActive: false,
      model: 'gpt-5.5',
      provider: 'openai-codex',
      hasEnv: true,
      skillCount: 12,
      gatewayRunning: true,
      avatar: null,
      displayName: null,
    },
    {
      name: 'coder',
      displayPath: 'profiles/coder',
      isDefault: false,
      isActive: true,
      model: 'sonnet',
      provider: null,
      hasEnv: false,
      skillCount: 4,
      gatewayRunning: false,
      avatar: null,
      displayName: null,
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useProfiles', () => {
  it('starts loading then resolves with the fetched profiles', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sample,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useProfiles(), { wrapper: wrapper() })
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-deck/profiles', expect.anything())
    expect(result.current.error).toBeNull()
    expect(result.current.data?.active).toBe('coder')
    expect(result.current.data?.profiles).toHaveLength(2)
  })

  it('surfaces an error on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response),
    )
    const { result } = renderHook(() => useProfiles(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy()
    expect(result.current.data).toBeNull()
  })

  it('surfaces an error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { result } = renderHook(() => useProfiles(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy()
  })

  it('refetch re-runs the request and clears a prior error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => sample } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useProfiles(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.error).toBeTruthy())

    await act(async () => {
      await result.current.refetch()
    })
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.data?.active).toBe('coder')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
