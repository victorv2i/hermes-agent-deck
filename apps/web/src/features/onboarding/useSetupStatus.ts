/**
 * `useSetupStatus` — polls the LOW-LEVEL first-run readiness probe
 * `GET /api/agent-deck/setup-status` (a separate fs/exec check, NOT the
 * dashboard's `/api/status`, which presupposes the dashboard is up).
 *
 * It collapses TanStack Query's lifecycle into the THREE states the onboarding
 * gate reasons about, so the fail-open safety property is unambiguous:
 *   - `undefined` → the first probe is still loading (hold the gate; no flash).
 *   - `null`      → the probe is UNREACHABLE (errored) → FAIL OPEN; a returning
 *                   user is never trapped behind a wizard they can't dismiss.
 *   - SetupStatus → a real readiness snapshot.
 *
 * The poll re-checks on an interval so a user who installs hermes / connects a
 * key in their terminal sees the wizard advance without a manual reload.
 */
import { useQuery } from '@tanstack/react-query'
import { SetupStatus } from '@agent-deck/protocol'
import { apiFetch } from '@/lib/apiFetch'

/** How often to re-probe readiness while the wizard is open (ms). */
export const SETUP_POLL_MS = 3_000

export const setupStatusKey = ['agent-deck', 'setup-status'] as const

/** Fetch + validate the low-level readiness probe. */
export async function fetchSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  const raw = await apiFetch<unknown>('/setup-status', { signal })
  return SetupStatus.parse(raw)
}

export interface UseSetupStatus {
  /** undefined = loading · null = unreachable (fail open) · SetupStatus = real. */
  status: SetupStatus | null | undefined
  /** True iff the probe errored (the fail-open signal); false while loading. */
  unreachable: boolean
  /** Force a re-probe (the "Re-check" button on the Detect/Connect rungs). */
  refetch: () => Promise<void>
  /** True while a (re)probe is in flight — drives the Re-check spinner. */
  isFetching: boolean
}

/**
 * Subscribe to the readiness probe with a polling re-check. `enabled` lets the
 * gate stop polling once the wizard is dismissed/closed.
 */
export function useSetupStatus(options: { enabled?: boolean } = {}): UseSetupStatus {
  const enabled = options.enabled ?? true
  const query = useQuery({
    queryKey: setupStatusKey,
    queryFn: ({ signal }) => fetchSetupStatus(signal),
    enabled,
    // Re-check on an interval so terminal-side setup advances the wizard live.
    refetchInterval: enabled ? SETUP_POLL_MS : false,
    // Don't cache stale "all false" across mounts — always re-probe fresh.
    staleTime: 0,
    retry: false,
  })

  // Collapse to the three-state contract: loading → undefined, error → null
  // (fail open), success → the snapshot.
  const status: SetupStatus | null | undefined = query.isError ? null : (query.data ?? undefined)

  return {
    status,
    unreachable: query.isError,
    isFetching: query.isFetching,
    refetch: async () => {
      await query.refetch()
    },
  }
}
