import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SystemGatewayState } from '@agent-deck/protocol'
import { statusKey } from '@/features/activity/useStatus'
import { modelsKey } from '@/features/models/useModels'
import { homeHealthKey, chatHealthKey } from '@/lib/api'
import { useRestartGateway } from './useSystem'

const mockRestartGateway = vi.fn<() => Promise<SystemGatewayState>>()
vi.mock('./api', () => ({
  restartGateway: () => mockRestartGateway(),
  fetchSystem: vi.fn(),
  applyHermesUpdate: vi.fn(),
  runDoctor: vi.fn(),
}))

/** The reads that gate the down notices (chat/Home/status/models). */
const gatingKeys = [statusKey, modelsKey, homeHealthKey, chatHealthKey]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey?: unknown } | undefined)?.queryKey))

beforeEach(() => {
  mockRestartGateway.mockReset()
})

describe('useRestartGateway', () => {
  it('invalidates the gating reads at the HOOK level: the nudge lands even after the calling component unmounts mid-restart', async () => {
    // Mutate-level callbacks are SKIPPED once the component has unmounted (the
    // observer no longer has listeners), and the StartAgentButton realistically
    // unmounts mid-mutation: the chat's 15s health repoll flips its gate while
    // the restart POST is still in flight. So the recovery invalidations must
    // live on the hook's own onSuccess, which runs on the mutation itself.
    const gate = deferred<SystemGatewayState>()
    mockRestartGateway.mockReturnValue(gate.promise)
    const client = makeClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result, unmount } = renderHook(() => useRestartGateway(), {
      wrapper: wrapper(client),
    })

    act(() => {
      result.current.mutate()
    })
    // No active component listener from here on.
    unmount()
    gate.resolve({ status: 'running' })

    await waitFor(() => {
      const keys = invalidatedKeys(invalidate)
      for (const key of gatingKeys) expect(keys).toContain(JSON.stringify(key))
    })
  })

  it('does NOT invalidate the gating reads when the re-probe is not running (no faked recovery nudge)', async () => {
    mockRestartGateway.mockResolvedValue({ status: 'failed' })
    const client = makeClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRestartGateway(), { wrapper: wrapper(client) })

    act(() => {
      result.current.mutate()
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // onSettled still refreshes the System dock's own read, but none of the
    // notice-gating reads are nudged: the agent is not actually back.
    expect(invalidate).toHaveBeenCalled()
    const keys = invalidatedKeys(invalidate)
    for (const key of gatingKeys) expect(keys).not.toContain(JSON.stringify(key))
  })
})
