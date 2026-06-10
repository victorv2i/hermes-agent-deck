import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SetupStatus } from '@agent-deck/protocol'
import { useSetupStatus } from './useSetupStatus'
import * as apiFetch from '@/lib/apiFetch'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const ready: SetupStatus = {
  hermesInstalled: true,
  providerConnected: true,
  agentNamed: true,
}

afterEach(() => vi.restoreAllMocks())

describe('useSetupStatus', () => {
  it('resolves the parsed SetupStatus from the BFF probe', async () => {
    vi.spyOn(apiFetch, 'apiFetch').mockResolvedValue(ready)
    const { result } = renderHook(() => useSetupStatus(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.status).toEqual(ready))
    // A successful probe is never the fail-open null.
    expect(result.current.unreachable).toBe(false)
  })

  it('FAILS OPEN: a probe error surfaces status:null + unreachable:true (never undefined)', async () => {
    vi.spyOn(apiFetch, 'apiFetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { result } = renderHook(() => useSetupStatus(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.unreachable).toBe(true))
    // null (fail open), NOT undefined (which would read as "still loading").
    expect(result.current.status).toBeNull()
  })

  it('reports undefined status while the first probe is in flight (loading, not a flash)', async () => {
    // A promise that never settles within the test → the hook stays loading.
    vi.spyOn(apiFetch, 'apiFetch').mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSetupStatus(), { wrapper: wrapper() })
    expect(result.current.status).toBeUndefined()
    expect(result.current.unreachable).toBe(false)
  })

  it('calls the low-level setup-status probe path (NOT /api/status)', async () => {
    const spy = vi.spyOn(apiFetch, 'apiFetch').mockResolvedValue(ready)
    renderHook(() => useSetupStatus(), { wrapper: wrapper() })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith('/setup-status', expect.anything())
  })
})
