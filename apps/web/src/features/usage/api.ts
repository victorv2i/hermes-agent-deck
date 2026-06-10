/**
 * Usage surface data fetcher — talks to the BFF route
 * (GET /api/agent-deck/usage?days=N) and returns the normalized summary. The BFF
 * already coerces nullable SUM columns; the shared apiFetch handles auth + the
 * ok-check + a typed error, so this client only names the route and the shape.
 */
import { apiFetch } from '@/lib/apiFetch'
import type { UsageSummary } from './types'

export async function fetchUsage(days: number, signal?: AbortSignal): Promise<UsageSummary> {
  return apiFetch<UsageSummary>(`/usage?days=${days}`, { signal })
}
