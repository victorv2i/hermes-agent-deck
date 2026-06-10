import { describe, it, expect } from 'vitest'
import { queryClient } from './queryClient'
import { ApiError } from './apiFetch'

/**
 * The one app-wide client carries the CONVERGED retry policy that used to be
 * duplicated (and divergent) across the former per-route clients. These assert
 * the policy directly off the client's defaults so a future regression is caught.
 */
describe('app-wide queryClient retry policy', () => {
  const retry = queryClient.getDefaultOptions().queries?.retry as (
    failureCount: number,
    error: Error,
  ) => boolean

  it('never retries a permanent 4xx (e.g. 403 sensitive, 404 missing)', () => {
    expect(retry(0, new ApiError('forbidden', 403, 'sensitive'))).toBe(false)
    expect(retry(0, new ApiError('missing', 404))).toBe(false)
    expect(retry(0, new ApiError('bad request', 400))).toBe(false)
  })

  it('retries a transient/upstream failure exactly once', () => {
    expect(retry(0, new ApiError('bad gateway', 502))).toBe(true)
    expect(retry(1, new ApiError('bad gateway', 502))).toBe(false)
    // A non-ApiError (network blip) is transient too.
    expect(retry(0, new Error('network down'))).toBe(true)
    expect(retry(1, new Error('network down'))).toBe(false)
  })

  it('does not refetch on window focus by default (surfaces opt in instead)', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
})
