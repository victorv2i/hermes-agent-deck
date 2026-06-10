import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import type { ProfilesResponse } from './types'

/**
 * Data hook for the Profiles surface — now on the app-wide TanStack Query
 * client (the former hand-rolled useState+fetch+AbortController is gone). The
 * `{ data, loading, error, refetch }` shape is preserved so the page is
 * unchanged, but caching, dedupe, and cross-surface invalidation come for free.
 */

export const profileKeys = {
  all: ['profiles'] as const,
}

export function fetchProfiles(signal?: AbortSignal): Promise<ProfilesResponse> {
  return apiFetch<ProfilesResponse>('/profiles', { signal })
}

export interface UseProfilesResult {
  data: ProfilesResponse | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useProfiles(): UseProfilesResult {
  const query = useQuery({
    queryKey: profileKeys.all,
    queryFn: ({ signal }) => fetchProfiles(signal),
    staleTime: 15_000,
  })
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.isError ? (query.error as Error).message : null,
    refetch: async () => {
      await query.refetch()
    },
  }
}
