import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SystemState,
  SystemGatewayState,
  HermesUpdateApplyResult,
  HermesUpdateChannel,
  HermesDoctorReport,
} from '@agent-deck/protocol'
import { statusKey } from '@/features/activity/useStatus'
import { modelsKey } from '@/features/models/useModels'
import { homeHealthKey, chatHealthKey } from '@/lib/api'
import { applyHermesUpdate, fetchSystem, restartGateway, runDoctor } from './api'

const systemKey = ['agent-deck', 'system'] as const

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
