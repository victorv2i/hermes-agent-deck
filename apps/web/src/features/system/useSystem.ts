import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SystemState,
  SystemGatewayState,
  HermesUpdateApplyResult,
  HermesUpdateChannel,
  HermesDoctorReport,
  SystemStats,
  CuratorStatus,
  ProviderValidateResult,
} from '@agent-deck/protocol'
import { statusKey } from '@/features/activity/useStatus'
import { modelsKey } from '@/features/models/useModels'
import { homeHealthKey, chatHealthKey } from '@/lib/api'
import {
  applyHermesUpdate,
  fetchCurator,
  fetchSystem,
  fetchSystemStats,
  restartGateway,
  runCurator,
  runDoctor,
  setCuratorPaused,
  validateProviderKey,
} from './api'

const systemKey = ['agent-deck', 'system'] as const
const systemStatsKey = ['agent-deck', 'system-stats'] as const
const curatorKey = ['agent-deck', 'curator'] as const

/**
 * Read the Maintenance dock state. Refetches on focus so a change made elsewhere
 * (CLI `hermes update`, a gateway restart from the terminal) is reflected when the
 * user returns. A modest `staleTime` keeps the dock from hammering the CLI probes.
 */
export function useSystem() {
  return useQuery<SystemState>({
    queryKey: systemKey,
    queryFn: ({ signal }) => fetchSystem(signal),
    staleTime: 10_000,
  })
}

/**
 * Re-check the dock (re-run the CLI probes) on demand. Returns a callback that
 * invalidates the system query so `useSystem` refetches — the honest way to
 * "Check for Hermes updates" (the availability comes from a fresh `hermes update
 * --check`, never a fabricated verdict). A no-op beyond the refetch; the result
 * lands in the existing `useSystem` consumers.
 */
export function useCheckSystem(): () => void {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: systemKey })
  }
}

/**
 * Restart the gateway. The BFF restarts then RE-PROBES, so the mutation result is
 * the gateway's actual state, not the command's exit. On settle we invalidate the
 * dock read so the GatewayCard re-resolves.
 *
 * On a RE-PROBED `running` we also invalidate the reads that gate the down
 * notices (status, models, and the Home/Chat health probes), so every surface
 * recovers from a fresh real read. This lives HERE, at the hook level, not in a
 * mutate-level callback: mutate-level callbacks are skipped when the calling
 * component has unmounted, and the StartAgentButton realistically unmounts
 * mid-restart (the chat's 15s health repoll flips its gate while the POST is
 * still in flight). Hook-level callbacks run on the mutation itself, listeners
 * or not. A System-page restart clearing the chat/Home notices is desired.
 */
export function useRestartGateway() {
  const qc = useQueryClient()
  return useMutation<SystemGatewayState, Error, void>({
    mutationFn: () => restartGateway(),
    onSuccess: (state) => {
      if (state.status !== 'running') return
      void qc.invalidateQueries({ queryKey: statusKey })
      void qc.invalidateQueries({ queryKey: modelsKey })
      void qc.invalidateQueries({ queryKey: homeHealthKey })
      void qc.invalidateQueries({ queryKey: chatHealthKey })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: systemKey })
    },
  })
}

/**
 * Apply a Hermes update on the chosen channel (default `stable`). Resolves with the
 * terminal {@link HermesUpdateApplyResult} (status + scrubbed log + re-probed
 * version + channel echo). On settle we invalidate the dock read so the
 * HermesUpdateCard re-resolves its per-channel availability/version from a fresh
 * probe — never from the apply's own (already-consumed) result.
 */
export function useApplyHermesUpdate() {
  const qc = useQueryClient()
  return useMutation<HermesUpdateApplyResult, Error, HermesUpdateChannel | void>({
    mutationFn: (channel) => applyHermesUpdate(channel ?? 'stable'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: systemKey })
    },
  })
}

/**
 * Run `hermes doctor` on demand. Resolves with the slim, secret-scrubbed
 * {@link HermesDoctorReport}. Not auto-run (doctor is slow); the DoctorCard fires it
 * from a button and renders the result, including the honest `unavailable` state.
 */
export function useRunDoctor() {
  return useMutation<HermesDoctorReport, Error, void>({
    mutationFn: () => runDoctor(),
  })
}

/** Read the live host/process snapshot for the System resources card. Refetch on
 * focus (a returning user sees fresh mem/disk); a modest stale time avoids churn. */
export function useSystemStats() {
  return useQuery<SystemStats>({
    queryKey: systemStatsKey,
    queryFn: ({ signal }) => fetchSystemStats(signal),
    staleTime: 10_000,
  })
}

/** Read the curator status + cadence for the Curator card. */
export function useCurator() {
  return useQuery<CuratorStatus>({
    queryKey: curatorKey,
    queryFn: ({ signal }) => fetchCurator(signal),
    staleTime: 10_000,
  })
}

/** Pause/resume the curator, then invalidate the curator read so the card
 * re-resolves from a fresh status rather than the ack's (already-consumed) value. */
export function useSetCuratorPaused() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean; paused: boolean }, Error, boolean>({
    mutationFn: (paused) => setCuratorPaused(paused),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: curatorKey })
    },
  })
}

/** Trigger a curator review now. The run is backgrounded on Hermes, so this only
 * acks; the Curator card's `last_run_at` re-resolves on the next read. */
export function useRunCurator() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () => runCurator(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: curatorKey })
    },
  })
}

/** Live-probe a provider key before saving. On-demand (never auto-run); the card
 * renders the honest accepted/rejected/unreachable verdict from the result. */
export function useValidateProviderKey() {
  return useMutation<ProviderValidateResult, Error, { key: string; value: string }>({
    mutationFn: ({ key, value }) => validateProviderKey(key, value),
  })
}
