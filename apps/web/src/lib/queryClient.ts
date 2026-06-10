/**
 * The ONE app-wide TanStack QueryClient. Every data surface (Sessions, Models,
 * Settings, Files, Usage, Profiles, Terminal status, health) reads/writes this
 * single cache, so a mutation on one surface can invalidate related queries on
 * another (cross-surface freshness) — impossible while Files and Usage each ran
 * their own isolated module-level client.
 *
 * The retry policy is the convergence of the two former per-route policies:
 * one retry for transient/upstream failures, but NEVER for a permanent 4xx
 * (403 sensitive, 404 missing, 400 bad request) — those won't get better on a
 * retry. Window-focus refetch is off by default; surfaces that want a live
 * "refetch on return to tab" feel opt in via their own `staleTime`/`refetchOn*`.
 */
import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './apiFetch'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false
        }
        return failureCount < 1
      },
    },
  },
})
