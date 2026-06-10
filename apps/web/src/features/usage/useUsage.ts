/**
 * react-query hook for the Usage surface. Keyed by the period (days) so
 * switching windows caches each window independently and refetches lazily.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchUsage } from './api'
import type { UsageSummary } from './types'

export interface UseUsageOptions {
  /**
   * Optional background poll interval (ms). The Usage surface omits it (a manual
   * window toggle is enough), but the header burn-rate pill passes ~60s so
   * today's spend stays live without a reload. React Query keys by `days`, so the
   * pill (days=1) and the surface (7/14/30) share the cache cleanly.
   */
  refetchInterval?: number
}

export function useUsage(days: number, options: UseUsageOptions = {}) {
  return useQuery<UsageSummary, Error>({
    queryKey: ['usage', days],
    queryFn: ({ signal }) => fetchUsage(days, signal),
    // Usage rolls up by day; a minute of staleness is plenty and avoids a
    // refetch on every period toggle round-trip.
    staleTime: 60_000,
    refetchInterval: options.refetchInterval,
  })
}
