import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  studioKeys,
  useStudioConfig,
  useWriteStudioConfig,
  useModelOptions,
  useSetProfileModel,
  useSoul,
  useWriteSoul,
  useStudioSkills,
  useToggleStudioSkill,
  useStudioEnv,
  useSetStudioEnv,
  useCreateStudioProfile,
  useSwitchActiveProfile,
} from './hooks'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

function mockJson(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('studioKeys', () => {
  it('scopes every cache key by the agent so two agents never share a cache entry', () => {
    expect(studioKeys.config('coder')).not.toEqual(studioKeys.config('writer'))
    expect(studioKeys.config('coder')).toEqual(['studio', 'config', 'coder'])
    // null (active profile) is its own stable key, distinct from a named agent.
    expect(studioKeys.config(null)).toEqual(['studio', 'config', '__active__'])
    expect(studioKeys.modelOptions('coder')).toEqual(['studio', 'model-options', 'coder'])
    expect(studioKeys.soul('coder')).toEqual(['studio', 'soul', 'coder'])
    expect(studioKeys.skills('coder')).toEqual(['studio', 'skills', 'coder'])
    expect(studioKeys.skills('coder')).not.toEqual(studioKeys.skills('writer'))
    expect(studioKeys.env('coder')).toEqual(['studio', 'env', 'coder'])
  })
})

describe('useStudioConfig', () => {
  it('reads the scoped config for the selected agent', async () => {
    const fetchMock = mockJson({ toolsets: ['web'] })
    const { result } = renderHook(() => useStudioConfig('coder'), { wrapper: wrap(makeClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.toolsets).toEqual(['web'])
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/agent-deck/studio/config?profile=coder')
  })
})

describe('useWriteStudioConfig', () => {
  it('invalidates the scoped config after a successful write', async () => {
    mockJson({ ok: true })
    const client = makeClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useWriteStudioConfig('coder'), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync({ memory: { memory_enabled: false } })
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.config('coder') })
  })
})

describe('useModelOptions', () => {
  it('reads scoped model options', async () => {
    const fetchMock = mockJson({ providers: [], model: '', provider: '' })
    const { result } = renderHook(() => useModelOptions('coder'), { wrapper: wrap(makeClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/agent-deck/studio/model-options?profile=coder')
  })

  it('does not fetch when no agent is selected', async () => {
    const fetchMock = mockJson({ providers: [], model: '', provider: '' })
    renderHook(() => useModelOptions(null), { wrapper: wrap(makeClient()) })
    // give any (unwanted) query a tick to fire
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useSetProfileModel', () => {
  it('invalidates model options AND config after a model set (config carries the model id)', async () => {
    mockJson({ ok: true, provider: 'anthropic', model: 'claude-opus-4-8' })
    const client = makeClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSetProfileModel('coder'), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync({ provider: 'anthropic', model: 'claude-opus-4-8' })
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.modelOptions('coder') })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.config('coder') })
  })
})

describe('useSoul', () => {
  it('reads the per-profile soul when an agent is given', async () => {
    const fetchMock = mockJson({ content: '# S', exists: true })
    const { result } = renderHook(() => useSoul('coder'), { wrapper: wrap(makeClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.content).toBe('# S')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/agent-deck/studio/profiles/coder/soul')
  })

  it('does not fetch when no agent is selected', async () => {
    const fetchMock = mockJson({ content: '', exists: false })
    renderHook(() => useSoul(null), { wrapper: wrap(makeClient()) })
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useWriteSoul', () => {
  it('invalidates the scoped soul after a save', async () => {
    mockJson({ ok: true })
    const client = makeClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useWriteSoul('coder'), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync('# new soul')
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.soul('coder') })
  })
})

describe('useStudioSkills', () => {
  it('reads the scoped skills list for the selected agent', async () => {
    const fetchMock = mockJson({
      skills: [{ name: 'web-search', description: 'd', category: null, enabled: true }],
    })
    const { result } = renderHook(() => useStudioSkills('coder'), { wrapper: wrap(makeClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      { name: 'web-search', description: 'd', category: null, enabled: true },
    ])
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/agent-deck/studio/skills?profile=coder')
  })
})

describe('useToggleStudioSkill', () => {
  it('optimistically flips the scoped cache and invalidates on settle', async () => {
    mockJson({ name: 'shell', enabled: true })
    const client = makeClient()
    // Seed the scoped cache so the optimistic write has something to flip.
    client.setQueryData(studioKeys.skills('coder'), [
      { name: 'shell', description: 'd', category: null, enabled: false },
    ])
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useToggleStudioSkill('coder'), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync({ name: 'shell', enabled: true })
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.skills('coder') })
    // The cache reflects the toggle (reconciled with the server echo).
    const cached = client.getQueryData(studioKeys.skills('coder')) as Array<{
      name: string
      enabled: boolean
    }>
    expect(cached.find((s) => s.name === 'shell')?.enabled).toBe(true)
  })

  it('reverts the optimistic write when the toggle fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('nope', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient()
    client.setQueryData(studioKeys.skills('coder'), [
      { name: 'shell', description: 'd', category: null, enabled: false },
    ])
    const { result } = renderHook(() => useToggleStudioSkill('coder'), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync({ name: 'shell', enabled: true }).catch(() => {})
    })
    const cached = client.getQueryData(studioKeys.skills('coder')) as Array<{
      name: string
      enabled: boolean
    }>
    // Reverted to the pre-toggle snapshot.
    expect(cached.find((s) => s.name === 'shell')?.enabled).toBe(false)
  })
})

describe('useStudioEnv', () => {
  it('reads scoped, shape-only env (no raw value reaches the cache)', async () => {
    mockJson({ env: { OPENAI_API_KEY: { is_set: true, redacted_value: 'sk-...9' } } })
    const { result } = renderHook(() => useStudioEnv('coder'), { wrapper: wrap(makeClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.env).toEqual([{ key: 'OPENAI_API_KEY', isSet: true }])
    expect(JSON.stringify(result.current.data)).not.toContain('redacted_value')
  })
})

describe('useSetStudioEnv', () => {
  it('invalidates the scoped env after a write', async () => {
    mockJson({ ok: true, key: 'OPENAI_API_KEY', restartRequired: true })
    const client = makeClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSetStudioEnv('coder'), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync({ key: 'OPENAI_API_KEY', value: 'sk-x' })
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.env('coder') })
  })
})

describe('useCreateStudioProfile', () => {
  it('invalidates the roster so a new (or cloned) agent appears', async () => {
    mockJson({ name: 'writer' })
    const client = makeClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateStudioProfile(), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync({ name: 'writer', cloneFrom: 'coder' })
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.profiles() })
  })
})

describe('useSwitchActiveProfile', () => {
  it('invalidates the roster so the active flag reflects the switch', async () => {
    mockJson({ active: 'coder' })
    const client = makeClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSwitchActiveProfile(), { wrapper: wrap(client) })
    await act(async () => {
      await result.current.mutateAsync('coder')
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: studioKeys.profiles() })
  })
})
