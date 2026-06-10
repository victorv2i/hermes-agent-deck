import { useQuery } from '@tanstack/react-query'
import { fetchSettings } from './api'
import type { SettingsPayload } from './types'

export type SettingsStatus = 'loading' | 'ready' | 'error'

export interface UseSettingsResult {
  status: SettingsStatus
  data: SettingsPayload | null
  error: Error | null
  /** Re-fetch the config (e.g. a "retry" / "refresh" action). */
  reload: () => void
}

export const settingsKeys = {
  config: ['settings', 'config'] as const,
}

/**
 * Load the (redacted) settings payload from the BFF on the app-wide TanStack
 * Query client (the former hand-rolled useState+fetch+AbortController is gone).
 * The `{ status, data, error, reload }` shape is preserved so the page is
 * unchanged, but caching, dedupe, and cross-surface invalidation come for free.
 */
export function useSettings(): UseSettingsResult {
  const query = useQuery({
    queryKey: settingsKeys.config,
    queryFn: ({ signal }) => fetchSettings(signal),
    staleTime: 15_000,
  })

  const status: SettingsStatus = query.isError ? 'error' : query.isSuccess ? 'ready' : 'loading'
  return {
    status,
    data: query.data ?? null,
    error: query.isError ? (query.error as Error) : null,
    reload: () => void query.refetch(),
  }
}
